import type { MaterialProcessingRunView } from "../../api/contracts";

export const maximumPdfBytes = 100 * 1024 * 1024;
export const automaticPollIntervalMs = 1_500;
export const materialProgressStages = [
  "queued",
  "evidence",
  "semantics",
  "publishing",
  "completed",
] as const;

export function materialProgressStageLabel(stage: MaterialProcessingRunView["progress_stage"]): string {
  if (stage === "queued") return "等待本機處理資源";
  if (stage === "evidence") return "整理頁面與教材來源";
  if (stage === "semantics") return "建立概念、關係與學習順序";
  if (stage === "publishing") return "發布可複核結果";
  return "處理完成";
}

export function materialElapsedLabel(createdAt: string, now: number): string {
  const startedAt = Date.parse(createdAt);
  if (!Number.isFinite(startedAt) || now < startedAt) return "剛剛開始";
  const totalSeconds = Math.floor((now - startedAt) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

type PdfFileDetails = Pick<File, "size" | "type">;

export function validatePdfFile(file: PdfFileDetails | null): string | null {
  if (!file) return "請先選擇 PDF 教材。";
  if (file.type !== "application/pdf") return "這不是可用的 PDF 檔案，請選擇副檔名為 .pdf 的教材。";
  if (file.size === 0) return "PDF 不可為空白檔案。";
  if (file.size > maximumPdfBytes) return "PDF 不可超過 100 MiB。";
  return null;
}

export function validatePdfSelection<T extends PdfFileDetails>(
  files: ArrayLike<T> | null,
): { file: T | null; message: string | null } {
  if (!files || files.length === 0) {
    return { file: null, message: "請先選擇 PDF 教材。" };
  }
  if (files.length !== 1) {
    return { file: null, message: "一次只能處理一份 PDF 教材。" };
  }
  const file = files[0];
  return { file, message: validatePdfFile(file) };
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KiB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function materialRunLabel(status: MaterialProcessingRunView["status"]): string {
  if (status === "pending") return "等待開始處理";
  if (status === "running") return "正在分析完整教材";
  if (status === "succeeded") return "處理完成，等待複核";
  if (status === "partial") return "部分內容需要複核";
  return "處理失敗";
}

export function materialFailureMessage(errorCode: string): string {
  if (errorCode === "RESTART_INTERRUPTED") return "服務重新啟動時中斷了這次處理。";
  if (errorCode === "MATERIAL_CONFIGURATION_INVALID" || errorCode === "RUNTIME_BINDING_INVALID") {
    return "本機教材處理環境未通過安全檢查。";
  }
  if (errorCode === "NO_USABLE_EVIDENCE" || errorCode === "NO_USABLE_CONCEPT") {
    return "教材沒有產生可安全回查的概念與依據。";
  }
  return "教材分析未能安全完成，沒有發布知識地圖。";
}

export function materialRunHasUsableMap(run: MaterialProcessingRunView): boolean {
  return run.output_binding !== null;
}
