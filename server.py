from flask import Flask, request, Response
from flask_cors import CORS
from openai import OpenAI
import requests # مكتبة مهمة جداً للبروكسي
import json
import time
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# المسار الجديد لفك حظر صور بينترست (البروكسي)
@app.route("/proxy_image", methods=["POST", "OPTIONS"])
def proxy_image():
    if request.method == "OPTIONS":
        return Response('{"status":"ok"}', status=200, mimetype="application/json")
    try:
        data = request.get_json(force=True, silent=True)
        img_url = data.get("url")
        # نتظاهر بأننا متصفح حقيقي لتخطي الحماية
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0'}
        img_resp = requests.get(img_url, headers=headers, stream=True)
        return Response(img_resp.content, mimetype=img_resp.headers.get('Content-Type', 'image/jpeg'))
    except Exception as e:
        return Response(json.dumps({"error": str(e)}), status=500, mimetype="application/json")

# مسار الذكاء الاصطناعي (كما هو بدون تغيير)

# في ملف server.py
# أضفنا فحص لكلمة مرور سرية (SECRET_ADMIN_TOKEN)

@app.route("/analyze", methods=["POST", "OPTIONS"])
def analyze_image():
    if request.method == "OPTIONS":
        return Response('{"status":"ok"}', status=200, mimetype="application/json")
    
    try:
        # فحص كلمة المرور السرية
        token = request.headers.get("X-Admin-Token")
        if token != "Samalkahli12345": # اختر أي باسورد صعب هنا
            return Response('{"error":"Unauthorized"}', status=401, mimetype="application/json")

        data = request.get_json(force=True, silent=True)
        # ... (باقي كودك كما هو) ...

        base64_image = data.get("image")
        image_url = data.get("image_url")
        sub_cat = data.get("sub_category", "عام")
        pinterest_title = data.get("pinterest_title", "لوحة فنية")

        if image_url: img_payload = {"url": image_url}
        elif base64_image: img_payload = {"url": f"data:image/jpeg;base64,{base64_image}"}
        else: return Response('{"error":"Missing image source"}', status=400, mimetype="application/json")

        prompt = f"""

        أنت خبير تسويق وسيو (SEO) متخصص في "بوسترتيك" - متجر رائد للوحات المعدنية الفاخرة.

        المهمة: تحليل الصورة المرفقة وصياغة محتوى بيعي باللغتين العربية والإنجليزية.



        السياق المساعد:

        - التصنيف: ({sub_cat})

        - العنوان الأصلي: ({pinterest_title})



        المطلوب صياغته بدقة:

        1. العناوين (title_ar / title_en):, عنوان مناسب رسمي يتضمن الشخصية او المشهد ويبدأ دائماً ب لوحة بوسترتيك المعدنيه || 

,وب الانجليزي يبدء Postertic Metal Poster ||



        2. الأوصاف (desc_ar / desc_en): وصف طويل (50-100 كلمة) يركز على:



           - التفاصيل البصرية، رهابة المشهد، وجمالية تدرج الألوان.



           - جودة الطباعة 4K الفائقة الوضوح والألوان المشبعة (Saturated Colors).



           - الخيارات المتاحة: ملمس مطفي (Matte) لمنع الانعكاسات، أو ملمس لامع (Glossy) لبريق يخطف الأنظار.



        3. الكلمات المفتاحية (keys_ar / keys_en): قائمة ذكية (12-15 كلمة) لكل لغة.



        يجب أن تكون النتيجة بتنسيق JSON فقط:

        {{

          "title_ar": "...", "title_en": "...",

          "desc_ar": "...", "desc_en": "...",

          "keys_ar": ["...", "..."], "keys_en": ["...", "..."]

        }}

        """

        for attempt in range(5):
            try:
                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    response_format={ "type": "json_object" },
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {"type": "image_url", "image_url": img_payload}
                            ]
                        }
                    ],
                    max_tokens=1500,
                    temperature=0.7 
                )
                return Response(response.choices[0].message.content, status=200, mimetype='application/json')
            except Exception as api_err:
                if "429" in str(api_err):
                    wait = (attempt + 1) * 4
                    print(f"⚠️ ضغط سيرفر! انتظار {wait} ثانية...")
                    time.sleep(wait)
                    continue 
                raise api_err

    except Exception as e:
        print("Error:", str(e))
        return Response(json.dumps({"error": str(e)}), status=500, mimetype="application/json")

if __name__ == "__main__":
    app.run(port=5050, debug=True)
