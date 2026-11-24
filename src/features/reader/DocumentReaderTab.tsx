import { useEffect } from 'react';
import ReaderWorkspace from './ReaderWorkspace';
import {
  type JumpToNoteAnchorEventDetail,
} from '../../app/appEvents';
import type { LiteraturePaper } from '../../types/library';
import type {
  PaperSummary,
  PositionedMineruBlock,
  ReaderSecrets,
  ReaderSettings,
  TranslationDisplayMode,
  WorkspaceItem,
} from '../../types/reader';
import {
  LibraryPreviewSyncPayload,
  ReaderDocumentTranslationSnapshot,
  ReaderTabBridgeState,
} from './documentReaderShared';
import { NoteDistillPreviewPanel } from '../notes/NoteDistillPreviewPanel';
import { RagChunkContextPreview } from './RagChunkContextPreview';

import { useReaderTabState } from './hooks/readerTabContext';
import { useReaderDocument } from './hooks/useReaderDocument';
import { useReaderSummary } from './hooks/useReaderSummary';
import { useReaderNotes } from './hooks/useReaderNotes';
import { useReaderAnnotations } from './hooks/useReaderAnnotations';
import { useReaderQa } from './hooks/useReaderQa';

interface DocumentReaderTabCallbacks {
  onZoteroUserIdChange: (value: string) => void;
  onQaActivePresetChange: (presetId: string) => void;
  onDocumentResolved: (item: WorkspaceItem) => void;
  onLibraryPreviewSync: (payload: LibraryPreviewSyncPayload) => void;
  onOpenPreferences: () => void;
  onOpenStandalonePdf: () => void;
  onAttachTranslatedPdf?: (document: WorkspaceItem) => Promise<boolean>;
  onBridgeStateChange: (tabId: string, bridge: ReaderTabBridgeState | null) => void;
  onTranslationDisplayModeChange: (mode: TranslationDisplayMode) => void;
  onNotePaperClick?: (paperId: string) => void;
  onPendingNoteAnchorJumpHandled?: (requestId?: string) => void;
}


interface DocumentReaderTabProps {
  tabId: string;
  document: WorkspaceItem;
  isActive: boolean;
  settings: ReaderSettings;
  readerApiConfig: ReaderSecrets;
  zoteroLocalDataDir: string;
  readerCallbacks: DocumentReaderTabCallbacks;
  translationTargetLanguageLabel: string;
  notePaperCandidates?: LiteraturePaper[];
  loadLibraryPreviewBlocks?: (item: WorkspaceItem) => Promise<{ blocks: PositionedMineruBlock[] }>;
  pendingNoteAnchorJump?: JumpToNoteAnchorEventDetail | null;
  translationSnapshot?: ReaderDocumentTranslationSnapshot | null;
  /** 文库侧已加载的同一文档概览；阅读器尚无概览时先行显示。 */
  libraryPreviewSummary?: PaperSummary | null;
  overviewPaper?: LiteraturePaper;
  libraryStorageDir?: string;
}



function DocumentReaderTab(props: DocumentReaderTabProps) {
  const state = useReaderTabState(props);
  const { activeBlockId, activeNoteId, activePdfHighlight, activeQaSession, aiConfigured, annotations, assistantDetached, attachTranslatedPdfBusy, blockScrollSignal, currentDocument, distillPreview, distillPreviewAppendTarget, distillVisionAvailable, distillVisionBusy, document, error, flatBlocks, handlePdfDocumentErrorChange, handlePdfPageCountChange, hoveredBlockId, isActive, isDraggingSplitter, l, lRef, layoutRef, leftPaneWidthRatio, libraryOperation, libraryPreviewSummary, libraryStorageDir, loading, locale, localeRef, mineruOutlineIndex, mineruPath, notes, onAttachTranslatedPdf, onBridgeStateChange, onLibraryPreviewSync, onOpenPreferences, onOpenStandalonePdf, onPendingNoteAnchorJumpHandled, onTranslationDisplayModeChange, overviewPaper, paperSummary, paperSummaryError, paperSummaryLoading, paperSummarySourceKey, pdfData, pdfHighlightSignal, pdfOpenFailed, pdfSource, pendingBlockAnchorJump, pendingNoteAnchorJump, qaAnswerRenderMode, qaAttachments, qaError, qaInput, qaMessages, qaModelPresets, qaRagEnabled, qaReasoningEffort, qaRunningSessionIds, qaScopeMode, qaScopePaperIds, qaSessions, readerNoteEditorSourceId, readingViewMode, screenshotBusy, selectedAnnotationId, selectedExcerpt, selectedQaPresetId, selectedQaSessionId, selectionDistilling, setActiveNoteId, setDistillPreview, setNotes, setQaAnswerRenderMode, setQaInput, setQaRagEnabled, setQaReasoningEffort, setReadingViewMode, setWorkspaceStage, settings, statusMessage, summaryCacheLoading, summaryConfigured, tabId, translationConfigured, translationTargetLanguageLabel, workspaceStage, zoteroLocalDataDir } = state;
  const documentApi = useReaderDocument(state);
  const summaryApi = useReaderSummary(state, documentApi);
  const notesApi = useReaderNotes(state, documentApi);
  const annotationsApi = useReaderAnnotations(state, documentApi, notesApi);
  const qaApi = useReaderQa(state, documentApi, summaryApi, notesApi, annotationsApi);
  const { activeBlockSummary, annotationSaveDirectory, availablePdfOptions, blockTranslations, canOpenOriginalPdf, currentJsonName, currentLocalPdfPath, currentPdfName, currentPdfVariantLabel, handleAttachTranslatedPdf, handleBlockClick, handleCancelDocumentTranslation, handleCloudParse, handleForceReparse, handleGenerateTranslatedPdf, handleOpenMineruJson, handleOpenOriginalPdf, handlePdfAnnotationSaveSuccess, handlePdfBlockHover, handlePdfBlockSelect, handlePdfReadingHeatmapChange, handlePdfScrollPositionChange, handleRetranslateBlock, handleSelectProjectPdf, handleSplitResizeStart, handleTranslateDocument, handleTranslateSelectedExcerpt, originalPdfPath, pdfReadingHeatmap, pdfScrollPosition, resetLayout, selectedExcerptError, selectedExcerptTranslating, selectedExcerptTranslation, translatedCount, translating, translationCancelling, translationProgressCompleted, translationProgressTotal } = documentApi;
  const { handleGeneratePaperSummary } = summaryApi;
  const { activeExcerptCard, canReidentifyDistillPreview, commitDistillPreview, handleAddBlockToNote, handleAddSelectionToNote, handleCancelDistillPreview, handleDistillSelectionToNote, handleGenerateDistillPreview, handleReidentifyDistillPreview, handleSaveAssistantMessageAsNote } = notesApi;
  const { handleAppendSelectedExcerptToQa, handleClearSelectedExcerpt, handleSelectAnnotation, handleTextSelect } = annotationsApi;
  const { handleAttachAssistant, handleCaptureSystemScreenshotNative, handleCreateQaSession, handleDeleteQaSession, handleLocateRagContextSlice, handlePreviewQaCitationContext, handleQaPresetChange, handleRemoveAttachment, handleSelectQaAttachments, handleSelectQaCitation, handleSelectQaSession, handleStopQa, handleSubmitQa, qaScopePaperOptions, ragContextCitation, selectedQaSessionLoading, setRagContextCitation, updateQaScope } = qaApi;

  useEffect(documentApi.effect_81, [document.translatedPdfPath, document.workspaceId]);
  useEffect(() => {
      localeRef.current = locale;
      lRef.current = l;
    }, [l, locale]);
  useEffect(qaApi.effect_116, [currentDocument.workspaceId]);
  useEffect(qaApi.effect_117, [activeQaSession]);
  useEffect(documentApi.effect_152, [documentApi.annotationSaveDirectory, documentApi.currentLocalPdfPath]);
  useEffect(summaryApi.effect_162, [
    currentDocument,
    documentApi.currentJsonName,
    documentApi.currentPdfName,
    flatBlocks.length,
    libraryOperation,
    summaryApi.libraryPreviewSourceKey,
    onLibraryPreviewSync,
    paperSummary,
    paperSummaryError,
    paperSummaryLoading,
    statusMessage,
  ]);
  useEffect(documentApi.effect_188, [documentApi.pdfTextSourceKey]);
  useEffect(annotationsApi.effect_196, [
    documentApi.activateBlock,
    documentApi.blockById,
    documentApi.createSelectionHighlightTarget,
    selectedExcerpt,
    documentApi.selectedExcerptTranslation,
    settings.highlightSelectionTranslation,
  ]);
  useEffect(annotationsApi.effect_197, [
    annotationsApi.handleClearSelectedExcerpt,
    selectedExcerpt,
    settings.enablePdfParagraphTranslationPopover,
    settings.enableSelectionTranslation,
  ]);
  useEffect(qaApi.effect_236, [currentDocument.workspaceId]);
  useEffect(qaApi.effect_244, [currentDocument.workspaceId]);
  useEffect(qaApi.effect_245, [currentDocument.workspaceId, qaSessions, selectedQaSessionId]);
  useEffect(documentApi.effect_246, [
    currentDocument.workspaceId,
    pdfSource,
  ]);
  useEffect(notesApi.effect_247, [currentDocument.itemKey, currentDocument.source, zoteroLocalDataDir]);
  useEffect(notesApi.effect_248, [notesApi.reloadNotes]);
  useEffect(notesApi.effect_249, [activeNoteId, readerNoteEditorSourceId, notesApi.reloadNotes, setActiveNoteId, setNotes]);
  useEffect(notesApi.effect_250, [
    notesApi.applyNoteAnchorJump,
    currentDocument.workspaceId,
    onPendingNoteAnchorJumpHandled,
    documentApi.pdfDocumentError,
    pdfOpenFailed,
    pdfSource,
    pendingNoteAnchorJump,
  ]);
  useEffect(notesApi.effect_251, [
    notesApi.applyNoteAnchorJump,
    flatBlocks.length,
    onPendingNoteAnchorJumpHandled,
    pendingBlockAnchorJump,
  ]);
  useEffect(documentApi.effect_252, [flatBlocks]);
  useEffect(documentApi.effect_253, [documentApi.saveCurrentPaperHistory]);
  useEffect(documentApi.effect_254, [
    currentDocument.workspaceId,
    isActive,
    qaSessions,
    documentApi.saveCurrentPaperHistory,
    selectedQaPresetId,
    selectedQaSessionId,
  ]);
  useEffect(documentApi.effect_255, [currentDocument.workspaceId, isActive]);
  useEffect(qaApi.effect_265, [document.attachmentKey, document.workspaceId, documentApi.openDocumentItem]);
  useEffect(summaryApi.effect_266, [libraryPreviewSummary, paperSummary, paperSummaryLoading]);
  useEffect(summaryApi.effect_267, [
    currentDocument,
    libraryOperation,
    paperSummaryLoading,
    summaryApi.paperSummaryNextSourceKey,
    paperSummarySourceKey,
    summaryApi.tryLoadSavedSummary,
  ]);
  useEffect(summaryApi.effect_268, [
    currentDocument,
    summaryApi.handleGeneratePaperSummary,
    paperSummaryLoading,
    summaryApi.paperSummaryNextSourceKey,
    paperSummarySourceKey,
    settings.autoGenerateSummary,
    summaryConfigured,
  ]);
  useEffect(annotationsApi.effect_269, [
    documentApi.handleTranslateSelectedExcerpt,
    selectedExcerpt,
    settings.autoTranslateSelection,
    settings.enableSelectionTranslation,
    translationConfigured,
  ]);
  useEffect(annotationsApi.effect_270, [documentApi.clearSelection, annotationsApi.handleClearSelectedExcerpt, isActive]);
  useEffect(qaApi.effect_277, [qaApi.bridgeState, onBridgeStateChange, tabId]);

  return (
      <div className="relative h-full min-h-0" hidden={!isActive}>
        <ReaderWorkspace
          onPdfPageCountChange={handlePdfPageCountChange}
          onPdfDocumentErrorChange={handlePdfDocumentErrorChange}
          active={isActive}
          currentDocument={currentDocument}
          overviewPaper={overviewPaper}
          libraryStorageDir={libraryStorageDir}
          mineruCacheDir={settings.mineruCacheDir}
          autoLoadSiblingJson={settings.autoLoadSiblingJson}
          overviewOperation={libraryOperation}
          selectedSectionTitle={
            currentDocument.source === 'standalone'
              ? settings.uiLanguage === 'en-US'
                ? 'Standalone Document'
                : '独立文献'
              : settings.uiLanguage === 'en-US'
                ? 'My Library'
                : '我的文库'
          }
          currentPdfName={currentPdfName}
          currentJsonName={currentJsonName}
          mineruPath={mineruPath}
          translatedCount={translatedCount}
          translationProgressCompleted={translationProgressCompleted}
          translationProgressTotal={translationProgressTotal}
          workspaceStage={workspaceStage}
          onStageChange={setWorkspaceStage}
          readingViewMode={readingViewMode}
          onReadingViewModeChange={setReadingViewMode}
          loading={loading}
          translating={translating}
          translationCancelling={translationCancelling}
          error={error}
          statusMessage={statusMessage}
          activeBlockSummary={activeBlockSummary}
          currentPdfVariantLabel={currentPdfVariantLabel}
          canOpenOriginalPdf={canOpenOriginalPdf}
          onOpenOriginalPdf={handleOpenOriginalPdf}
          currentPdfPath={currentLocalPdfPath || availablePdfOptions[0]?.path || ''}
          availablePdfOptions={availablePdfOptions}
          onCurrentPdfPathChange={handleSelectProjectPdf}
          pdfAnnotationSaveDirectory={annotationSaveDirectory}
          originalPdfPath={originalPdfPath}
          pdfSource={pdfSource}
          pdfData={pdfData}
          pdfScrollPosition={pdfScrollPosition}
          pdfReadingHeatmap={pdfReadingHeatmap}
          onPdfScrollPositionChange={handlePdfScrollPositionChange}
          onPdfReadingHeatmapChange={handlePdfReadingHeatmapChange}
          blocks={flatBlocks}
          mineruOutlineIndex={mineruOutlineIndex}
          translations={blockTranslations}
          translationDisplayMode={settings.translationDisplayMode}
          translationLanguageLabel={translationTargetLanguageLabel}
          activeBlockId={activeBlockId}
          hoveredBlockId={hoveredBlockId}
          activePdfHighlight={activePdfHighlight}
          pdfHighlightSignal={pdfHighlightSignal}
          blockScrollSignal={blockScrollSignal}
          smoothScroll={settings.smoothScroll}
          enablePdfReadingHeatmap={settings.enablePdfReadingHeatmap}
          softPageShadow={settings.softPageShadow}
          compactReading={settings.compactReading}
          showBlockMeta={settings.showBlockMeta}
          hidePageDecorationsInBlockView={settings.hidePageDecorationsInBlockView}
          leftPaneWidthRatio={leftPaneWidthRatio}
          layoutRef={layoutRef}
          resizingSplit={isDraggingSplitter}
          onStartResize={handleSplitResizeStart}
          onResetLayout={resetLayout}
          onPdfBlockHover={handlePdfBlockHover}
          onPdfBlockSelect={handlePdfBlockSelect}
          onBlockClick={handleBlockClick}
          onAddBlockToNote={handleAddBlockToNote}
          onRetranslateBlock={(block) => void handleRetranslateBlock(block)}
          onTranslationDisplayModeChange={onTranslationDisplayModeChange}
          onTextSelect={handleTextSelect}
          onOpenStandalonePdf={onOpenStandalonePdf}
          onGenerateTranslatedPdf={currentDocument.source === 'native-library' ? () => void handleGenerateTranslatedPdf() : undefined}
          onAttachTranslatedPdf={onAttachTranslatedPdf ? () => void handleAttachTranslatedPdf() : undefined}
          attachTranslatedPdfBusy={attachTranslatedPdfBusy}
          onOpenMineruJson={() => void handleOpenMineruJson()}
          onCloudParse={() => void handleCloudParse()}
          onForceReparse={() => void handleForceReparse()}
          onTranslateDocument={() => void handleTranslateDocument()}
          onCancelTranslateDocument={handleCancelDocumentTranslation}
          onOpenPreferences={onOpenPreferences}
          notes={notes}
          onAddSelectionToNote={() => void handleAddSelectionToNote()}
          onDistillSelectionToNote={() => void handleDistillSelectionToNote()}
          onDistillSelectionAppendToCard={() => void handleDistillSelectionToNote({ appendToActiveCard: true })}
          activeExcerptCardTitle={activeExcerptCard?.title ?? null}
          selectionDistilling={selectionDistilling}
          annotations={annotations}
          selectedAnnotationId={selectedAnnotationId}
          onSelectAnnotation={handleSelectAnnotation}
          paperSummary={paperSummary}
          paperSummaryLoading={paperSummaryLoading}
          summaryCacheLoading={summaryCacheLoading}
          summarySourceReady={settings.summarySourceMode === 'pdf-text' ? Boolean(pdfSource) : flatBlocks.length > 0}
          paperSummaryError={paperSummaryError}
          onGenerateSummary={(options) => void handleGeneratePaperSummary(true, options?.force)}
          qaSessions={qaSessions}
          selectedQaSessionId={selectedQaSessionId}
          qaMessages={qaMessages}
          qaInput={qaInput}
          qaAttachments={qaAttachments}
          qaModelPresets={qaModelPresets}
          selectedQaPresetId={selectedQaPresetId}
          qaRagEnabled={qaRagEnabled}
          qaScopeMode={qaScopeMode}
          qaScopePaperIds={qaScopePaperIds}
          qaScopePaperOptions={qaScopePaperOptions}
          qaAnswerRenderMode={qaAnswerRenderMode}
          qaReasoningEffort={qaReasoningEffort}
          screenshotLoading={screenshotBusy}
          onQaInputChange={setQaInput}
          onQaSubmit={(inputOverride?: string) => void handleSubmitQa(inputOverride)}
          onQaStop={handleStopQa}
          onQaPresetChange={handleQaPresetChange}
          onQaRagEnabledChange={setQaRagEnabled}
          onQaScopeChange={updateQaScope}
          onQaAnswerRenderModeChange={setQaAnswerRenderMode}
          onQaReasoningEffortChange={setQaReasoningEffort}
          onQaSessionCreate={handleCreateQaSession}
          onQaSessionSelect={handleSelectQaSession}
          onQaSessionDelete={handleDeleteQaSession}
          onSelectImageAttachments={() => void handleSelectQaAttachments('image')}
          onSelectFileAttachments={() => void handleSelectQaAttachments('file')}
          onCaptureScreenshot={() => void handleCaptureSystemScreenshotNative()}
          onRemoveAttachment={handleRemoveAttachment}
          onCitationClick={handleSelectQaCitation}
          onCitationContext={handlePreviewQaCitationContext}
          onSaveAssistantMessageAsNote={handleSaveAssistantMessageAsNote}
          qaLoading={selectedQaSessionLoading}
          qaRunningSessionIds={qaRunningSessionIds}
          qaError={qaError}
          selectedExcerpt={selectedExcerpt}
          selectedExcerptTranslation={selectedExcerptTranslation}
          selectedExcerptTranslating={selectedExcerptTranslating}
          selectedExcerptError={selectedExcerptError}
          autoTranslateSelection={settings.enableSelectionTranslation && settings.autoTranslateSelection}
          onAppendSelectedExcerptToQa={handleAppendSelectedExcerptToQa}
          onTranslateSelectedExcerpt={() => void handleTranslateSelectedExcerpt()}
          onClearSelectedExcerpt={handleClearSelectedExcerpt}
          onPdfAnnotationSaveSuccess={handlePdfAnnotationSaveSuccess}
          aiConfigured={aiConfigured}
          overviewConfigured={summaryConfigured}
          assistantDetached={assistantDetached}
          leftSidebarCollapsed={false}
          onToggleLeftSidebar={() => undefined}
          onAttachAssistant={handleAttachAssistant}
          showLibraryToggle={false}
        />
        {distillPreview ? (
          <NoteDistillPreviewPanel
            state={distillPreview}
            appendTargetTitle={distillPreviewAppendTarget?.title ?? null}
            supportsVision={distillVisionAvailable}
            canReidentify={canReidentifyDistillPreview}
            reidentifying={distillVisionBusy}
            onStateChange={(patch) => setDistillPreview((current) => (current ? { ...current, ...patch } : current))}
            onGenerate={() => void handleGenerateDistillPreview()}
            onReidentify={() => void handleReidentifyDistillPreview()}
            onConfirm={() => void commitDistillPreview()}
            onDirectSave={() => void commitDistillPreview(true)}
            onCancel={handleCancelDistillPreview}
          />
        ) : null}
        {ragContextCitation ? (
          <RagChunkContextPreview
            documentKey={currentDocument.workspaceId}
            citation={ragContextCitation}
            onClose={() => setRagContextCitation(null)}
            onLocate={handleLocateRagContextSlice}
          />
        ) : null}
      </div>
    );
}

export default DocumentReaderTab;

