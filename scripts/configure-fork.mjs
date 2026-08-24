import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const [, , owner, repo = 'PaperQuay'] = process.argv;
if (!owner || !/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
  console.error('Usage: node scripts/configure-fork.mjs <github-owner> [repository]');
  process.exit(2);
}

const root = process.cwd();
const packagePath = path.join(root, 'package.json');
const updatePath = path.join(root, 'electron', 'backend', 'updateCommands.cjs');

let packageText = fs.readFileSync(packagePath, 'utf8');
const publishPattern = /("provider":\s*"github",\s*"owner":\s*)"[^"]+"(,\s*"repo":\s*)"[^"]+"/;
if (!publishPattern.test(packageText)) {
  throw new Error('Could not find the GitHub publisher configuration in package.json.');
}
packageText = packageText.replace(publishPattern, `$1"${owner}"$2"${repo}"`);
fs.writeFileSync(packagePath, packageText);

let updateText = fs.readFileSync(updatePath, 'utf8');
const updatePattern = /(const UPDATE_REPOSITORY = \{\s*owner:\s*)'[^']+'(,\s*repo:\s*)'[^']+'/;
if (!updatePattern.test(updateText)) {
  throw new Error('Could not find the update repository configuration.');
}
updateText = updateText.replace(updatePattern, `$1'${owner}'$2'${repo}'`);
fs.writeFileSync(updatePath, updateText);

console.log(`Configured release and update repository: ${owner}/${repo}`);
