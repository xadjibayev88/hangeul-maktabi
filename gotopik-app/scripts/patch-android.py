"""Run after `npx cap add android`: permissions, AdMob app id, icons, version."""
import os, re, shutil, sys
app_id, ver = sys.argv[1], sys.argv[2]
root = "android/app/src/main"
m = open(f"{root}/AndroidManifest.xml", encoding="utf-8").read()
perms = ['android.permission.INTERNET', 'android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']
for p in perms:
    if p not in m:
        m = m.replace("<application", f'<uses-permission android:name="{p}" />\n    <application', 1)
if "<queries>" not in m:
    m = m.replace("<application", '<queries><intent><action android:name="android.speech.RecognitionService" /></intent>'
                  '<intent><action android:name="android.intent.action.TTS_SERVICE" /></intent></queries>\n    <application', 1)
meta = f'<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="{app_id}" />'
if "gms.ads.APPLICATION_ID" not in m:
    m = m.replace("</application>", f"    {meta}\n    </application>", 1)
open(f"{root}/AndroidManifest.xml", "w", encoding="utf-8").write(m)
res = f"{root}/res"
for d in os.listdir(res):
    if d.startswith("mipmap-anydpi"):
        shutil.rmtree(os.path.join(res, d))
    elif d.startswith("mipmap-"):
        for name in ("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"):
            shutil.copy("resources/icon.png", os.path.join(res, d, name))
g = "android/app/build.gradle"
s = open(g, encoding="utf-8").read()
s = re.sub(r"versionCode \d+", f"versionCode {ver}", s)
s = re.sub(r'versionName "[^"]*"', f'versionName "1.0.{ver}"', s)
open(g, "w", encoding="utf-8").write(s)
print("android patched")
