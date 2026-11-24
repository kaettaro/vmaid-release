param([string]$Out,[int]$Size)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $Size,$Size,([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode='AntiAlias'; $g.TextRenderingHint='AntiAliasGridFit'; $g.Clear([System.Drawing.Color]::Transparent)
$pink = [System.Drawing.Color]::FromArgb(255,224,103,154)
$g.FillEllipse((New-Object System.Drawing.SolidBrush $pink), 0,0,($Size-1),($Size-1))
$font = New-Object System.Drawing.Font('Segoe UI',($Size*0.46),[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
$fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment='Center'; $fmt.LineAlignment='Center'
$rect = New-Object System.Drawing.RectangleF 0,(-$Size*0.01),$Size,$Size
$g.DrawString('Vm',$font,[System.Drawing.Brushes]::White,$rect,$fmt)
$g.Dispose(); $bmp.Save($Out,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
