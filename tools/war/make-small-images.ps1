# E0-4: 웨일북용 64px 그림 사본 만들기 -> app/trade/assets/small/
# 읽기: app/trade/img/{terrain,res,unit,bld,city}/*.png, app/trade/assets/units/*.png,
#       app/trade/assets/cities/neutral_*.png (전쟁 버전 중립 도시국가 그림 - 나중에 덮어씀)
# 쓰기: app/trade/assets/small/{terrain,res,unit,bld,city}/ 같은 이름
# 규칙: 긴 변 64px(비율 유지, 투명 유지). 지형(육각) 그림만 가로 64px.
# 두 번 실행해도 같은 결과. 마지막에 파일 수와 전체 용량 출력.
# nation은 읽지 않는다. 이 스크립트는 app/trade 원본을 읽기만 하고 고치지 않는다.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
public static class Shrink {
  // 긴 변 64px(비율 유지). wide=true면 가로를 64px로 (지형 육각 그림)
  public static void Make(string src, string dst, bool wide) {
    using (Bitmap s = new Bitmap(src)) {
      int w, h;
      if (wide) { w = 64; h = Math.Max(1, (int)Math.Round((double)s.Height * 64 / s.Width)); }
      else if (s.Width >= s.Height) { w = 64; h = Math.Max(1, (int)Math.Round((double)s.Height * 64 / s.Width)); }
      else { h = 64; w = Math.Max(1, (int)Math.Round((double)s.Width * 64 / s.Height)); }
      using (Bitmap d = new Bitmap(w, h, PixelFormat.Format32bppArgb))
      using (Graphics g = Graphics.FromImage(d)) {
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.SmoothingMode = SmoothingMode.HighQuality;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.DrawImage(s, 0, 0, w, h);
        d.Save(dst, ImageFormat.Png);
      }
    }
  }
}
'@
$root = 'C:\projects\earth-server\app\trade'
$out = Join-Path $root 'assets\small'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }   # 두 번 실행해도 같은 결과
$jobs = @()
# 무역 앱 그림 (img 아래 5개 폴더). 지형만 가로 64px
foreach ($sub in 'terrain', 'res', 'unit', 'bld', 'city') {
  $srcDir = Join-Path $root "img\$sub"
  if (-not (Test-Path $srcDir)) { continue }
  $dstDir = Join-Path $out $sub
  New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
  foreach ($f in Get-ChildItem $srcDir -Filter *.png) {
    $jobs += , @($f.FullName, (Join-Path $dstDir $f.Name), ($sub -eq 'terrain'))
  }
}
# 전쟁 버전 새 그림 (구축함·전투기) -> small/unit/
$dstUnit = Join-Path $out 'unit'
foreach ($f in Get-ChildItem (Join-Path $root 'assets\units') -Filter *.png) {
  $jobs += , @($f.FullName, (Join-Path $dstUnit $f.Name), $false)
}
# 중립 도시국가 3곳은 전쟁 버전 그림(app/trade/assets/cities)을 나중에 덮어써요 (설계 8-2: 전쟁 버전은 이 그림을 씀)
foreach ($f in Get-ChildItem (Join-Path $root 'assets\cities') -Filter neutral_*.png) {
  $jobs += , @($f.FullName, (Join-Path $out ("city\" + $f.Name)), $false)
}
foreach ($j in $jobs) { [Shrink]::Make($j[0], $j[1], $j[2]) }
$files = Get-ChildItem $out -Recurse -Filter *.png
$bytes = ($files | Measure-Object Length -Sum).Sum
Write-Host ("small/ 그림 " + $files.Count + "개, 총 " + [Math]::Round($bytes / 1KB, 1) + " KB")
