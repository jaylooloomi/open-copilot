# Synthesizes the UTF-8 text in -TextFile into a 48 kHz 16-bit mono WAV with a zh-TW voice
# (Microsoft Hanhan when installed) and prints the voice name. Used by the Windows transcriber
# integration test and the web real-voice e2e (apps/web/e2e-real).
# Keep this file saved as UTF-8 with BOM: Windows PowerShell 5 reads BOM-less scripts in the ANSI code page.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$TextFile
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-TW' })
  if ($voices.Count -eq 0) { throw 'No zh-TW voice is installed' }
  $voice = $voices | Where-Object { $_.VoiceInfo.Name -like 'Microsoft Hanhan*' } | Select-Object -First 1
  if ($null -eq $voice) { $voice = $voices[0] }
  $synth.SelectVoice($voice.VoiceInfo.Name)
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToWaveFile($Out, $format)
  $synth.Speak($text)
} finally {
  $synth.Dispose()
}
Write-Output $voice.VoiceInfo.Name
