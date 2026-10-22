export interface TranscribeInput {
  /** 單段音訊（webm/opus 或 mp4）；檔名需帶副檔名，OpenAI 依副檔名判斷格式。 */
  file: File;
  /** 前一段已轉寫的文字，可為空字串。 */
  prompt: string;
}

export interface Transcriber {
  transcribe(input: TranscribeInput): Promise<string>;
}
