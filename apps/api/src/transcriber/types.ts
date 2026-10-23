export interface TranscribeInput {
  /** 單段音訊（webm/opus 或 mp4）；檔名需帶副檔名，上游服務（OpenAI 或 Groq）依副檔名判斷格式。 */
  file: File;
  /** 前一段已轉寫的文字，可為空字串。 */
  prompt: string;
  /**
   * 用戶端斷線或逾時時會被 abort（選填，向後相容）。實作應轉交給上游呼叫，
   * 讓前端放棄的請求不再繼續佔用、計費，也不會跟前端的重試疊在一起。
   */
  signal?: AbortSignal;
}

export interface Transcriber {
  transcribe(input: TranscribeInput): Promise<string>;
}
