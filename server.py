from flask import Flask, request, Response
from flask_cors import CORS
from openai import OpenAI
import json
import time
import os
from dotenv import load_dotenv
load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

@app.route('/analyze', methods=['POST', 'OPTIONS'])
def analyze_image():
    if request.method == 'OPTIONS':
        return Response('{"status":"ok"}', status=200, mimetype='application/json')
        
    try:
        data = request.get_json(force=True, silent=True)
        if not data or 'image' not in data:
            return Response('{"error":"Missing image data"}', status=400, mimetype='application/json')
            
        # توحيد اسم المتغير بشكل صحيح
        base64_image = data.get('image')
        sub_cat = data.get('sub_category', 'عام')
        
        # البرومبت الديناميكي
        prompt = f"""
        أنت خبير سيو (SEO) متخصص في متجر "بوسترتيك" للوحات المعدنية الفاخرة. 
        المعلومة الأساسية: هذه اللوحة تنتمي لتصنيف: ({sub_cat}).
        
        قم بتحليل الصورة المرفقة بناءً على هذا التصنيف واستخرج البيانات التالية باللغة العربية:

        1. العنوان (title): اسم الشخصية أو المشهد الرئيسي من ( {sub_cat} ) مع وصف فخم قصير (مثل: لوحة ليفاي أكرمان الفخمة - هجوم العمالقة).
        
        2. الوصف (desc): وصف تسويقي طويل (أكثر من 50 كلمة) يركز على المشهد وعلاقته بـ {sub_cat}. 
           - اذكر تفاصيل الرسم والرهابة في المشهد.
           - وضح فخامة اللوحة المعدنية المطفية (matte) وكيف تناسب عشاق {sub_cat}.

        3. الكلمات المفتاحية (keys): قائمة (10-15 كلمة) تشمل:
           - اسم العمل ({sub_cat})، أسماء الشخصيات المتوقعة، كلمات (لوحة معدنية، بوستر انمي، ديكور جيمنج، جودة HD، بدون لمعة).

        الرد يجب أن يكون JSON فقط:
        {{
          "title": "العنوان الفخم هنا",
          "desc": "الوصف التسويقي الطويل هنا...",
          "keys": ["كلمة1", "كلمة2", "كلمة3"]
        }}
        """
        
        # نظام المحاولة التلقائية عند الضغط
        for attempt in range(3):
            try:
                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    response_format={ "type": "json_object" },
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                # استخدام المتغير الصحيح هنا
                                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                            ]
                        }
                    ],
                    max_tokens=1500,
                    temperature=0.7 
                )
                
                result_str = response.choices[0].message.content
                result_json = json.loads(result_str)
                safe_json_str = json.dumps(result_json, ensure_ascii=True)
                
                return Response(safe_json_str, status=200, mimetype='application/json')
                
            except Exception as api_err:
                err_str = str(api_err)
                if "429" in err_str or "Rate limit" in err_str:
                    print(f"Rate limit hit! Waiting 2.5 seconds... (Attempt {attempt + 1} of 3)")
                    time.sleep(2.5)
                    continue
                else:
                    raise api_err
                    
        return Response('{"error": "Too much pressure on OpenAI servers. Try again later."}', status=500, mimetype='application/json')

    except Exception as e:
        print("Server Error:", str(e))
        err_msg = json.dumps({"error": str(e)}, ensure_ascii=True)
        return Response(err_msg, status=500, mimetype='application/json')

if __name__ == '__main__':
    print("Server is running on port 5050...")
    app.run(port=5050, debug=True)
