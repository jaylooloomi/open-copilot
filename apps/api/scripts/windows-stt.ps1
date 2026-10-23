# Recognizes zh-TW speech in a 16 kHz mono WAV with the Windows built-in System.Speech engine
# and prints {"text":"..."} as UTF-8 on stdout. Used by apps/api/src/transcriber/windowsTranscriber.ts.
# Keep this file saved as UTF-8 with BOM: Windows PowerShell 5 reads BOM-less scripts in the ANSI code page.
param([Parameter(Mandatory = $true)][string]$Wav)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$culture = [System.Globalization.CultureInfo]::GetCultureInfo('zh-TW')
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($culture)
$parts = New-Object System.Collections.Generic.List[string]
try {
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.SetInputToWaveFile($Wav)
  while ($true) {
    # Recognize() returns null at the end of the file; some files throw instead. Both end the loop.
    # The exception text goes to stderr so a partial transcript can still be diagnosed; the normal
    # end-of-file exception ("no audio input") lands there too and is harmless on exit code 0.
    try { $result = $engine.Recognize() } catch { [Console]::Error.WriteLine($_.Exception.Message); break }
    if ($null -eq $result) { break }
    if ($result.Text) { $parts.Add($result.Text) }
  }
} finally {
  $engine.Dispose()
}

$json = ConvertTo-Json -InputObject @{ text = ($parts -join '') } -Compress
$bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($json)
$stdout = [Console]::OpenStandardOutput()
$stdout.Write($bytes, 0, $bytes.Length)
$stdout.Flush()
