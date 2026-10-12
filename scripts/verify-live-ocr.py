import sys
sys.path.insert(0,'ai-backend')
from app.config import settings
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import httpx
root=Path('server/.test-runtime');root.mkdir(exist_ok=True)
image=Image.new('RGB',(1600,650),'white');draw=ImageDraw.Draw(image);font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',40)
text='SYNTHETIC BLOOD CP TEST - NO PATIENT DATA\nHemoglobin 12.5 g/dL 10 - 20\nWBC 6000 /uL 4000 - 11000\nPlatelets 250000 /uL 150000 - 410000\nMCV 90 fL 80 - 100'
draw.multiline_text((50,50),text,font=font,fill='black',spacing=35)
file=root/'synthetic-blood-cp.png';image.save(file)
with httpx.Client(timeout=30) as client:
    health=client.get('http://127.0.0.1:8000/api/health').json()
    print('Actual service readiness:', {'reachable':True,'ocr':health['ocr_available'],'model':health['ollama_connected']})
    with file.open('rb') as f:
        r=client.post('http://127.0.0.1:8000/api/reports/extract',headers={'X-Internal-Key':settings.INTERNAL_API_KEY},files={'file':('synthetic-blood-cp.png',f,'image/png')})
    assert r.status_code==200, 'Actual image OCR did not complete'
    data=r.json();assert len(data['tests'])>=4, 'Expected four synthetic OCR rows'
    assert data['report_date'] is None, 'A missing report date was invented'
    print('Actual Tesseract image extraction passed:',len(data['tests']),'synthetic rows; no invented date')
