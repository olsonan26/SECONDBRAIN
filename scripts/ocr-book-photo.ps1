param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await-Result($Operation, [Type]$ResultType) {
  $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  $task.Result
}
$file = Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await-Result ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
try {
  $decoder = Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  $ratio = [Math]::Min(1.0, $max / [Math]::Max($decoder.PixelWidth, $decoder.PixelHeight))
  $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
  $transform.ScaledWidth = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelWidth * $ratio))
  $transform.ScaledHeight = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelHeight * $ratio))
  $bitmap = Await-Result ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
  try {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (!$engine) { throw 'No local Windows OCR language is available.' }
    $result = Await-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $lines = @($result.Lines | ForEach-Object { @{ text=$_.Text; words=@($_.Words | ForEach-Object { @{ text=$_.Text; x=$_.BoundingRect.X; y=$_.BoundingRect.Y; width=$_.BoundingRect.Width; height=$_.BoundingRect.Height } }) } })
    @{ text=$result.Text; width=$bitmap.PixelWidth; height=$bitmap.PixelHeight; lines=$lines; engine='Windows.Media.Ocr'; warning='OCR is unverified transcription, not authoritative source text.' } | ConvertTo-Json -Depth 8 -Compress
  } finally { $bitmap.Dispose() }
} finally { $stream.Dispose() }
