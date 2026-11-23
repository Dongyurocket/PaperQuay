import {
  decryptReaderSecretPayload,
  encryptReaderSecretPayload,
  getAppDefaultPaths,
  readLocalTextFileIfExists,
  writeLocalTextFile,
  type AppDefaultPaths,
} from './desktop';
import type { ReaderConfigFile } from '../types/reader';

/** 与主进程 secretStorage 保持一致的密文标记。 */
const ENCRYPTED_SECRET_PREFIX = 'enc:';

/**
 * 配置文件的读写必须区分三态：
 * - loaded：文件存在且解析成功；
 * - missing：ENOENT，真正的首次运行；
 * - error：读取（EACCES/EBUSY）或解析失败。
 * 只有 loaded / missing 才允许后续持久化；error 时保持文件原样，避免用默认值
 * 覆盖文件里的 API Key。
 */
export type ReaderConfigLoadResult =
  | { status: 'loaded'; config: Partial<ReaderConfigFile> }
  | { status: 'missing' }
  | { status: 'error'; error: Error };

export interface ReaderConfigDependencies {
  readTextFileIfExists: (path: string) => Promise<string | null>;
  writeTextFile: (path: string, content: string) => Promise<void>;
  /** 用 Electron safeStorage 加密整段 secrets JSON；不可用时原样返回。 */
  encryptSecretPayload?: (payload: string) => Promise<string>;
  decryptSecretPayload?: (payload: string) => Promise<string>;
}

export interface ReaderConfigHydrationResult {
  /** 读到的配置；null 表示没有可用的配置文件（首次运行或读取失败）。 */
  config: Partial<ReaderConfigFile> | null;
  /** false 时必须禁用配置写回，避免覆盖读不出来的原文件。 */
  persistenceEnabled: boolean;
  /** 非 null 表示读取/解析失败，调用方应向用户展示可恢复错误。 */
  error: Error | null;
}

/**
 * 备份使用固定文件名而不是时间戳：备份里是明文 API Key，
 * 每次启动新增一份会让密钥副本无限累积。
 */
export function readerConfigBackupPath(configPath: string): string {
  return `${configPath}.bak`;
}

const defaultDependencies: ReaderConfigDependencies = {
  readTextFileIfExists: readLocalTextFileIfExists,
  writeTextFile: writeLocalTextFile,
  encryptSecretPayload: encryptReaderSecretPayload,
  decryptSecretPayload: decryptReaderSecretPayload,
};

type ReaderConfigWithEncryptedSecrets = Partial<ReaderConfigFile> & {
  secretsEncrypted?: unknown;
};

function toError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(typeof error === 'string' ? error : 'Unknown reader config error');
}

async function decryptConfigSecrets(
  parsed: ReaderConfigWithEncryptedSecrets,
  dependencies: ReaderConfigDependencies,
): Promise<ReaderConfigWithEncryptedSecrets> {
  const encrypted = parsed.secretsEncrypted;

  if (typeof encrypted !== 'string' || !encrypted) {
    // 旧版明文配置：原样读入，下一次写回时自动迁移为密文。
    delete parsed.secretsEncrypted;
    return parsed;
  }

  if (!dependencies.decryptSecretPayload) {
    throw new Error('Encrypted reader config requires Electron safeStorage.');
  }

  const decrypted = await dependencies.decryptSecretPayload(encrypted);
  const secrets = JSON.parse(decrypted) as ReaderConfigFile['secrets'];
  delete parsed.secretsEncrypted;
  parsed.secrets = secrets;
  return parsed;
}

/** 读取指定路径的配置：不存在返回 null；读取/解析失败直接抛错。 */
export async function readReaderConfigFileAt(
  configPath: string,
  dependencies: ReaderConfigDependencies = defaultDependencies,
): Promise<Partial<ReaderConfigFile> | null> {
  const configText = await dependencies.readTextFileIfExists(configPath);

  // null = ENOENT（真首次运行）。存在但为空/只有空白，通常是写入中断，
  // 按损坏处理，不能当成首次运行用默认值覆盖掉。
  if (configText === null) {
    return null;
  }

  if (!configText.trim()) {
    throw new Error('Reader config file is empty.');
  }

  const parsed: unknown = JSON.parse(configText);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Reader config file must contain a JSON object.');
  }

  return decryptConfigSecrets(parsed as ReaderConfigWithEncryptedSecrets, dependencies);
}

export async function readReaderConfigFile(
  defaultPaths?: AppDefaultPaths | null,
  dependencies: ReaderConfigDependencies = defaultDependencies,
): Promise<Partial<ReaderConfigFile> | null> {
  const paths = defaultPaths ?? await getAppDefaultPaths();
  return readReaderConfigFileAt(paths.configPath, dependencies);
}

/** 三态读取；不会抛错，便于 hydration 明确区分首次运行与损坏文件。 */
export async function loadReaderConfig(
  defaultPaths?: AppDefaultPaths | null,
  dependencies: ReaderConfigDependencies = defaultDependencies,
): Promise<ReaderConfigLoadResult> {
  const paths = defaultPaths ?? await getAppDefaultPaths();

  try {
    const config = await readReaderConfigFileAt(paths.configPath, dependencies);
    return config ? { status: 'loaded', config } : { status: 'missing' };
  } catch (error) {
    return { status: 'error', error: toError(error) };
  }
}

/**
 * 启动 hydration 计划：主配置优先，缺失时回退旧的 executableDir 配置。
 * 任一文件读取/解析失败都返回 persistenceEnabled=false。
 */
export async function resolveReaderConfigForHydration({
  defaultPaths,
  legacyConfigPath,
  dependencies = defaultDependencies,
}: {
  defaultPaths: AppDefaultPaths;
  legacyConfigPath?: string;
  dependencies?: ReaderConfigDependencies;
}): Promise<ReaderConfigHydrationResult> {
  try {
    const config = await readReaderConfigFileAt(defaultPaths.configPath, dependencies);

    if (config) {
      return { config, persistenceEnabled: true, error: null };
    }

    if (legacyConfigPath) {
      const legacyConfig = await readReaderConfigFileAt(legacyConfigPath, dependencies);
      if (legacyConfig) {
        return { config: legacyConfig, persistenceEnabled: true, error: null };
      }
    }

    return { config: null, persistenceEnabled: true, error: null };
  } catch (error) {
    return { config: null, persistenceEnabled: false, error: toError(error) };
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * 密文每次加密都会变（DPAPI 带随机熵），不能直接比较 JSON 文本，
 * 否则每次启动都会误判为「内容有变」并重写 .bak。这里解密旧配置后按语义比较。
 */
async function isExistingConfigEquivalent(
  existingText: string,
  config: Partial<ReaderConfigFile>,
  serialized: Record<string, unknown>,
  dependencies: ReaderConfigDependencies,
): Promise<boolean> {
  try {
    const existing = JSON.parse(existingText) as ReaderConfigWithEncryptedSecrets;
    if (!existing || typeof existing !== 'object') return false;

    let existingSecrets: unknown = existing.secrets ?? null;
    if (typeof existing.secretsEncrypted === 'string' && existing.secretsEncrypted) {
      if (!dependencies.decryptSecretPayload) return false;
      existingSecrets = JSON.parse(await dependencies.decryptSecretPayload(existing.secretsEncrypted));
    }

    const { secrets: _existingSecrets, secretsEncrypted: _existingEncrypted, ...existingRest } = existing;
    const { secrets: _nextSecrets, secretsEncrypted: _nextEncrypted, ...nextRest } = serialized;

    // 旧明文配置即使语义相同也必须写一次，完成到密文的迁移。
    const existingHasPlaintextSecrets = Boolean(
      _existingSecrets &&
      typeof _existingSecrets === 'object' &&
      Object.keys(_existingSecrets as unknown as Record<string, unknown>).length > 0,
    );
    if (existingHasPlaintextSecrets && typeof _nextEncrypted === 'string') {
      return false;
    }

    return stableStringify(existingSecrets) === stableStringify(config.secrets ?? null)
      && stableStringify(existingRest) === stableStringify(nextRest);
  } catch {
    return false;
  }
}

/**
 * 写入配置：
 * 1. 覆盖前把原文件复制为固定名 `<config>.bak`（内容不变则不重写，避免每次启动都产生副本）；
 *    secrets 在备份里同样先加密，避免 `.bak` 成为明文密钥副本；
 * 2. 写入后读回校验，失败即抛错；
 * 3. 调用方只在写回校验成功后删除 localStorage 中的旧密钥副本。
 */
export async function writeReaderConfigFile(
  config: Partial<ReaderConfigFile>,
  defaultPaths?: AppDefaultPaths | null,
  dependencies: ReaderConfigDependencies = defaultDependencies,
): Promise<void> {
  const paths = defaultPaths ?? await getAppDefaultPaths();
  const { secrets, ...rest } = config;
  const serialized: Record<string, unknown> = { ...rest };

  if (secrets && Object.keys(secrets).length > 0) {
    const plaintext = JSON.stringify(secrets);
    const encrypted = dependencies.encryptSecretPayload
      ? await dependencies.encryptSecretPayload(plaintext)
      : plaintext;

    if (encrypted.startsWith(ENCRYPTED_SECRET_PREFIX)) {
      serialized.secretsEncrypted = encrypted;
    } else {
      // 加密后端不可用（例如缺少 keyring 的 Linux）：保持可用的明文配置，
      // 而不是写入一份无法解密的密文。
      serialized.secrets = secrets;
    }
  }

  const text = JSON.stringify(serialized, null, 2);
  const existing = await dependencies.readTextFileIfExists(paths.configPath);

  if (existing) {
    if (await isExistingConfigEquivalent(existing, config, serialized, dependencies)) {
      // 语义未变化：不重写文件，也不刷新 .bak（密文本身每次都会变）。
      return;
    }

    await dependencies.writeTextFile(
      readerConfigBackupPath(paths.configPath),
      await encryptBackupSecrets(existing, dependencies),
    );
  }

  await dependencies.writeTextFile(paths.configPath, text);

  const readBack = await dependencies.readTextFileIfExists(paths.configPath);

  if (readBack !== text) {
    throw new Error('Reader config write verification failed; the previous file was kept as a backup.');
  }
}

/** 旧配置里可能还是明文 secrets；备份前先加密，避免备份文件泄露 API Key。 */
async function encryptBackupSecrets(
  existingText: string,
  dependencies: ReaderConfigDependencies,
): Promise<string> {
  if (!dependencies.encryptSecretPayload) return existingText;

  try {
    const parsed = JSON.parse(existingText) as ReaderConfigWithEncryptedSecrets;
    if (!parsed || typeof parsed !== 'object' || !parsed.secrets) return existingText;

    const encrypted = await dependencies.encryptSecretPayload(JSON.stringify(parsed.secrets));
    if (!encrypted.startsWith(ENCRYPTED_SECRET_PREFIX)) return existingText;

    delete parsed.secrets;
    parsed.secretsEncrypted = encrypted;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return existingText;
  }
}
