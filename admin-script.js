const firebaseConfig = { apiKey: "AIzaSyCJWBVYry9VNnxCKynEcxOi5PoKqJjzJWI", authDomain: "postertic-bc971.firebaseapp.com", projectId: "postertic-bc971", storageBucket: "postertic-bc971.firebasestorage.app", messagingSenderId: "835487461356", appId: "1:835487461356:web:a4e8bad6e48ea1a3a99ac9" };
if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
const db = firebase.firestore(), auth = firebase.auth(), storage = firebase.storage();

// --- حقن أكواد CSS الذكية للسحب والإفلات ---
const dragStyle = document.createElement('style');
dragStyle.innerHTML = `
.sortable-ghost { opacity: 0.4; background: rgba(33, 150, 243, 0.2) !important; border: 1px solid #2196f3 !important; }
.drag-handle:active { cursor: grabbing !important; }
.cat-drag-item { transition: background 0.3s; }
`;
document.head.appendChild(dragStyle);

auth.onAuthStateChanged(u => { if (u) { document.body.style.display = 'block'; init(); } else window.location.href = 'login.html'; });
function logout() { auth.signOut().then(() => window.location.href = 'login.html'); }
function showToast(m) { const t = document.getElementById('toast'); t.innerText = m; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 3000); }
function updateLabel(i) { document.getElementById('fileLabel').innerText = `تم اختيار ${i.files.length} صور جاهزة`; }

async function getFileHash(file) {
    const buffer = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function uploadToStorage(blobOrFile, fileName) {
    const ref = storage.ref().child(`posters/${Date.now()}_${fileName}`);
    await ref.put(blobOrFile);
    return await ref.getDownloadURL();
}

let pendingPinterestItems = [];

window.previewPinterestBulk = () => {
    const raw = document.getElementById('pinJsonData').value.trim();
    const main = document.getElementById('pinMainCat').value;
    if (!raw || !main) return alert("يرجى اختيار القسم ولصق بيانات بينترست أولاً.");
    try {
        pendingPinterestItems = JSON.parse(raw).filter(p => p.title && p.title.trim().length > 3 && isNaN(p.title));
    } catch (e) { return alert("❌ خطأ في حزمة البيانات المنسوخة."); }
    if (pendingPinterestItems.length === 0) return alert("⚠️ لم يتم العثور على لوحات صالحة.");
    renderReviewGrid();
    document.getElementById('reviewModal').style.display = 'flex';
};

window.renderReviewGrid = () => {
    const grid = document.getElementById('reviewGrid');
    const reviewCount = document.getElementById('reviewCount');

    if (pendingPinterestItems.length === 0) {
        grid.innerHTML = "<div style='grid-column:1/-1; text-align:center; padding:50px; color:#888;'>القائمة فارغة.</div>";
        if (reviewCount) reviewCount.innerText = "0";
        document.getElementById('confirmReviewBtn').disabled = true;
        return;
    }

    if (reviewCount) reviewCount.innerText = pendingPinterestItems.length;
    document.getElementById('confirmReviewBtn').disabled = false;

    grid.innerHTML = pendingPinterestItems.map((item, index) => `
        <div class="review-card" id="pin_card_${index}" style="transition: all 0.3s ease;">
            <button class="delete-review-btn" onclick="removeReviewItem(${index})">🗑️</button>
            <div style="width:100%; height:250px; background:#111; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                <img src="${item.url}" 
                     referrerpolicy="no-referrer"
                     onerror="handleImageError(this, ${index})"
                     style="width:100%; height:100%; object-fit:cover;">
            </div>
            <div class="title" style="font-size:12px; padding:10px; color:#ccc;">${item.title}</div>
        </div>
    `).join('');
};

window.handleImageError = (imgElement, index) => {
    const card = document.getElementById(`pin_card_${index}`);
    if (card) {
        card.style.opacity = '0';
        card.style.transform = 'scale(0.8)';
        setTimeout(() => {
            card.remove();
            if (pendingPinterestItems[index]) {
                pendingPinterestItems[index].broken = true;
                updatePendingCount();
            }
        }, 300);
    }
};

window.removeReviewItem = (index) => {
    const card = document.getElementById(`pin_card_${index}`);
    if (card) {
        card.style.opacity = '0';
        card.style.transform = 'scale(0.8)';
        setTimeout(() => {
            card.remove();
            pendingPinterestItems[index].broken = true; 
            updatePendingCount();
        }, 300);
    }
};

function updatePendingCount() {
    const validItems = pendingPinterestItems.filter(item => !item.broken);
    const reviewCount = document.getElementById('reviewCount');
    if (reviewCount) reviewCount.innerText = validItems.length;
    if (validItems.length === 0) document.getElementById('confirmReviewBtn').disabled = true;
}

window.executePinterestBulk = async () => {
    const main = document.getElementById('pinMainCat').value;
    const sub = document.getElementById('pinSubCat').value || "عام";
    const btn = document.getElementById('confirmReviewBtn');
    
    const itemsToUpload = pendingPinterestItems.filter(item => !item.broken);
    const total = itemsToUpload.length;
    
    if (total === 0) return alert("لا توجد صور صالحة للرفع.");

    btn.disabled = true;
    document.getElementById('pBarContainer').style.display = 'block';
    const pBar = document.getElementById('pBar');

    let uploadedCount = 0; let duplicateCount = 0; let errorCount = 0; let aiFailedCount = 0;
    let aiErrorReasons = new Set();
    sessionHashes.clear(); sessionUrls.clear();

    for (let i = 0; i < total; i++) {
        const item = itemsToUpload[i];
        btn.innerText = `⏳ جاري رفع ${i + 1} من ${total}...`;

        try {
            const imgResp = await fetch('https://postertic.onrender.com/proxy_image', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: item.url })
            });
            if (!imgResp.ok) throw new Error("Proxy failed");

            const blob = await imgResp.blob();
            const hash = await getFileHash(blob);

            const isDup = await isDuplicate(hash, item.url);
            if (isDup) { duplicateCount++; continue; }

            let ai = {};
            try {
                const aiResp = await fetch(`https://postertic.onrender.com/analyze`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-Admin-Token": "Samalkahli12345" },
                    body: JSON.stringify({ image_url: item.url, sub_category: sub, pinterest_title: item.title })
                });
                
                if (aiResp.ok) {
                    ai = await aiResp.json();
                } else {
                    aiFailedCount++;
                    let errText = await aiResp.text().catch(()=>"");
                    if (aiResp.status === 429 || errText.includes("quota")) aiErrorReasons.add("رصيد OpenAI انتهى 💳");
                    else if (aiResp.status >= 502) aiErrorReasons.add("السيرفر نائم 😴");
                    else aiErrorReasons.add(`خطأ سيرفر (${aiResp.status})`);
                }
            } catch (e) { aiFailedCount++; aiErrorReasons.add("تعذر الاتصال بالمحلل 🌐"); }

            const imageUrl = await uploadToStorage(blob, `pin_${Date.now()}_${i}.jpg`);
            await db.collection("products").add({
                mainCategory: main, subCategory: sub, imageUrl: imageUrl,
                originalUrl: item.url,
                title_ar: ai.title_ar || item.title || "بدون عنوان", title_en: ai.title_en || "",
                desc_ar: ai.desc_ar || "", desc_en: ai.desc_en || "",
                keys_ar: ai.keys_ar || [], keys_en: ai.keys_en || [],
                fileHash: hash, timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            uploadedCount++;

        } catch (e) { 
            errorCount++; 
        }

        pBar.style.width = (((i + 1) / total) * 100) + '%';
    }

    document.getElementById('pBarContainer').style.display = 'none';
    closeReviewModal();
    document.getElementById('pinJsonData').value = '';
    
    let reportMsg = `📊 تقرير الرفع:\n✅ تم الرفع: ${uploadedCount}\n⚠️ مكرر: ${duplicateCount}\n❌ فشل: ${errorCount}`;
    if (aiFailedCount > 0) {
        reportMsg += `\n\n🤖 تنبيه: ${aiFailedCount} لوحة رفعت بدون تحليل ذكي بسبب:\n- ` + Array.from(aiErrorReasons).join('\n- ');
    }
    alert(reportMsg);
    init();
};

window.saveManualProducts = async () => {
    const m = document.getElementById('productMainCat').value,
        s = document.getElementById('productSubCat').value || "عام",
        files = document.getElementById('productFile').files,
        useAI = document.getElementById('useAI').checked,
        btn = document.getElementById('prodBtn');
    if (!m || files.length === 0) return alert("يرجى اختيار القسم والصور.");
    btn.disabled = true; document.getElementById('pBarContainer').style.display = 'block';
    const pBar = document.getElementById('pBar');
    
    let uploadedCount = 0; let duplicateCount = 0; let errorCount = 0; let aiFailedCount = 0;
    let aiErrorReasons = new Set();
    sessionHashes.clear(); sessionUrls.clear();

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        btn.innerText = `⏳ جاري معالجة ${i + 1}/${files.length}`;
        try {
            const hash = await getFileHash(file);
            const isDup = await isDuplicate(hash, null);
            if (isDup) { duplicateCount++; pBar.style.width = (((i + 1) / files.length) * 100) + '%'; continue; }

            let ai = { title_ar: "بدون عنوان", title_en: "", desc_ar: "", desc_en: "", keys_ar: [], keys_en: [] };
            if (useAI) {
                const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
                try {
                    const aiResp = await fetch(`https://postertic.onrender.com/analyze`, {
                        method: "POST", 
                        headers: { "Content-Type": "application/json", "X-Admin-Token": "Samalkahli12345" },
                        body: JSON.stringify({ image: base64, sub_category: s })
                    });
                    if (aiResp.ok) {
                        ai = await aiResp.json();
                    } else {
                        aiFailedCount++;
                        let errText = await aiResp.text().catch(()=>"");
                        if (aiResp.status === 429 || errText.toLowerCase().includes("quota") || errText.toLowerCase().includes("exceeded")) {
                            aiErrorReasons.add("رصيد OpenAI (ChatGPT) انتهى 💳");
                        } else if (aiResp.status >= 502 && aiResp.status <= 504) {
                            aiErrorReasons.add("السيرفر نائم ويحتاج وقت للتشغيل 😴");
                        } else {
                            aiErrorReasons.add(`خطأ سيرفر داخلي (كود: ${aiResp.status}) ⚠️`);
                        }
                    }
                } catch (netErr) {
                    aiFailedCount++;
                    aiErrorReasons.add("السيرفر نائم تماماً أو غير متصل 😴 (Network Error)");
                }
            }

            const imageUrl = await uploadToStorage(file, file.name);
            await db.collection("products").add({
                mainCategory: m, subCategory: s, imageUrl: imageUrl,
                title_ar: ai.title_ar || "بدون عنوان", title_en: ai.title_en || "",
                desc_ar: ai.desc_ar || "", desc_en: ai.desc_en || "",
                keys_ar: ai.keys_ar || [], keys_en: ai.keys_en || [],
                fileHash: hash, timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            uploadedCount++;
        } catch (e) { errorCount++; }
        pBar.style.width = (((i + 1) / files.length) * 100) + '%';
    }
    document.getElementById('pBarContainer').style.display = 'none';
    btn.disabled = false; btn.innerText = "رفع ومعالجة يدوي 🚀";
    
    let reportMsg = `📊 تقرير الرفع اليدوي:\n✅ تم الرفع: ${uploadedCount}\n⚠️ مكررة: ${duplicateCount}\n❌ أخطاء الصورة: ${errorCount}`;
    if (aiFailedCount > 0) {
        reportMsg += `\n\n🤖 تحذير: تم الرفع بدون الذكاء الاصطناعي لـ ${aiFailedCount} لوحة.\n🔍 الأسباب المكتشفة لتعطل الذكاء الاصطناعي:\n- ` + Array.from(aiErrorReasons).join('\n- ');
    }
    alert(reportMsg);
    if (uploadedCount > 0) init();
};

let siteCats = {};
async function init() {
    const cSnap = await db.collection("categories").get();
    const pM = document.getElementById('productMainCat'), pPin = document.getElementById('pinMainCat'), cL = document.getElementById('categoriesAdminList');
    pM.innerHTML = pPin.innerHTML = '<option value="">اختر القسم الرئيسي</option>'; 
    let html = ''; siteCats = {};
    let catsArr = []; cSnap.forEach(doc => catsArr.push({ id: doc.id, ...doc.data() }));
    
    catsArr.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(c => {
        siteCats[c.id] = c; 
        pM.innerHTML += `<option value="${c.id}">${c.id}</option>`; 
        pPin.innerHTML += `<option value="${c.id}">${c.id}</option>`;
        
        let subs = (c.subs || []).map(s => `
            <div style="background:#222; margin:8px 0; padding:12px; border-radius:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span>• ${s}</span>
                    <div style="display:flex; gap:8px;">
                        <button class="save-btn" style="padding:5px 10px; font-size:12px;" onclick="toggleInlineEdit('${s}')">تعديل ونقل</button>
                        <button class="danger-btn" style="padding:5px 10px; font-size:12px;" onclick="deleteSubCat('${c.id}', '${s}')">حذف</button>
                    </div>
                </div>
                <div class="edit-inline-ui" id="edit_ui_${s}">
                    <input type="text" id="in_name_${s}" value="${s}">
                    <select id="in_main_${s}">${catsArr.map(cat => `<option value="${cat.id}" ${cat.id === c.id ? 'selected' : ''}>ينتمي لـ: ${cat.id}</option>`).join('')}</select>
                    <button class="save-btn" style="width:100%" onclick="updateSubCatFull('${c.id}','${s}')">تحديث وحفظ</button>
                </div>
            </div>`).join('');
            
        const catImgHtml = c.imageUrl ? `<img src="${c.imageUrl}" style="width:35px; height:35px; object-fit:cover; border-radius:6px; margin-left:10px; border:1px solid #333;">` : '';
        
        // --- بناء كروت الأقسام الذكية الجديدة القابلة للسحب ---
        html += `
        <div class="cat-drag-item" data-id="${c.id}" style="margin-bottom:10px; background:#1a1a1a; border:1px solid #333; border-radius:8px; overflow:hidden;">
            <button class="acc-btn" onclick="toggleAcc(this)" style="display:flex; align-items:center; padding:10px 15px; width:100%; border:none; background:transparent; color:#fff; font-size:16px; font-weight:bold; cursor:pointer;">
                <div class="drag-handle" style="cursor:grab; color:#2196f3; font-size:24px; padding-left:15px; user-select:none;" onclick="event.stopPropagation()">☰</div>
                <div style="display:flex; align-items:center; flex:1;">${catImgHtml} <span style="margin-right:10px;">📂 ${c.id} (الترتيب: <span class="cat-order-num">${c.order || 0}</span>)</span></div>
                <span>▼</span>
            </button>
            <div class="acc-content" style="padding:15px; background:#111; border-top:1px solid #333;">
                <div style="display:flex; gap:10px; margin-bottom:15px; flex-wrap:wrap;">
                    <button class="save-btn" onclick="addSubCat('${c.id}')">+ إضافة فرعي</button>
                    <button class="save-btn" style="background:#444;" onclick="document.getElementById('img_edit_${c.id}').click()">🖼️ تغيير الصورة</button>
                    <input type="file" id="img_edit_${c.id}" accept="image/*" style="display:none;" onchange="updateCatImage('${c.id}', this)">
                    <button class="save-btn" style="background:var(--primary, #2196f3); color:#fff;" onclick="renameCategory('${c.id}')">تعديل الاسم ✏️</button>
                    <button class="danger-btn" onclick="deleteMainCat('${c.id}')">حذف القسم</button>
                </div>
                ${subs || '<small style="color:#444">لا يوجد تصنيفات فرعية</small>'}
            </div>
        </div>`;
    });
    cL.innerHTML = html;

    // --- جلب وتشغيل مكتبة السحب بشكل صامت وذكي ---
    if (typeof Sortable !== 'undefined') {
        initSortable(cL);
    } else {
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js";
        script.onload = () => initSortable(cL);
        document.head.appendChild(script);
    }

    const pSnap = await db.collection("products").orderBy("timestamp", "desc").get();
    const pL = document.getElementById('productsList');
    let grouped = {}; pSnap.forEach(doc => {
        let p = doc.data(); p.id = doc.id;
        let m = p.mainCategory || "عام", s = p.subCategory || "عام";
        if (!grouped[m]) grouped[m] = {}; if (!grouped[m][s]) grouped[m][s] = [];
        grouped[m][s].push(p);
    });
    pL.innerHTML = Object.keys(grouped).map(m => `
        <button class="acc-btn" onclick="toggleAcc(this)">${m} <span>▼</span></button>
        <div class="acc-content">${Object.keys(grouped[m]).map(s => `
            <button class="acc-btn" style="background:#111; font-size:14px;" onclick="toggleAcc(this)">${s} (${grouped[m][s].length})</button>
            <div class="acc-content">${grouped[m][s].map(p => `
                <div class="list-item">
                    <input type="checkbox" class="prod-cb" value="${p.id}" style="width:20px; height:20px;">
                    <img src="${p.imageUrl}" class="item-img">
                    <div style="flex:1;">
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:8px;">
                            <input type="text" id="tar_${p.id}" value="${p.title_ar || p.seoTitle || ''}" placeholder="العنوان (عربي)">
                            <input type="text" id="ten_${p.id}" value="${p.title_en || ''}" placeholder="العنوان (إنجليزي)" dir="ltr">
                        </div>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:8px;">
                            <textarea id="dar_${p.id}" rows="3" placeholder="الوصف (عربي)">${p.desc_ar || p.seoDescription || ''}</textarea>
                            <textarea id="den_${p.id}" rows="3" placeholder="Description (EN)" dir="ltr">${p.desc_en || ''}</textarea>
                        </div>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:8px;">
                            <input type="text" id="kar_${p.id}" value="${(p.keys_ar || p.seoKeywords || []).join('، ')}" placeholder="سيو (عربي)">
                            <input type="text" id="ken_${p.id}" value="${(p.keys_en || []).join(', ')}" placeholder="SEO (EN)" dir="ltr">
                        </div>
                        <div style="display:flex; gap:10px; margin-top:5px;">
                            <button class="save-btn" onclick="updateSEO('${p.id}')">حفظ ✅</button>
                            <button class="danger-btn" onclick="if(confirm('حذف؟')) db.collection('products').doc('${p.id}').delete().then(init)">حذف</button>
                        </div>
                    </div>
                </div>`).join('')}
            </div>`).join('')}
        </div>`).join('');
    
    loadInventory();
}

// --- دوال تفعيل السحب والحفظ التلقائي ---
function initSortable(el) {
    new Sortable(el, {
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'sortable-ghost',
        onEnd: function () { saveCategoriesOrder(); }
    });
}

window.saveCategoriesOrder = async () => {
    const items = document.querySelectorAll('.cat-drag-item');
    const batch = db.batch();
    items.forEach((item, index) => {
        const catId = item.getAttribute('data-id');
        const docRef = db.collection("categories").doc(catId);
        batch.update(docRef, { order: index });
        const orderSpan = item.querySelector('.cat-order-num');
        if(orderSpan) orderSpan.innerText = index;
    });
    try {
        await batch.commit();
        showToast("✅ تم حفظ الترتيب الجديد بنجاح!");
    } catch (error) {
        console.error(error);
        alert("❌ فشل في حفظ الترتيب.");
    }
};

// --- تحديث دالة فتح/إغلاق الأقسام الذكية ---
window.toggleAcc = (b) => {
    const content = b.nextElementSibling; 
    const isOpen = content.classList.contains('show');
    const parentBlock = b.parentElement;
    
    // إغلاق المجلدات الأخرى المفتوحة بذكاء دون التأثير على الترتيب
    if (parentBlock.classList.contains('cat-drag-item')) {
        parentBlock.parentElement.querySelectorAll('.cat-drag-item > .acc-content').forEach(c => c.classList.remove('show'));
    } else {
        parentBlock.querySelectorAll(':scope > .acc-content').forEach(c => c.classList.remove('show'));
    }
    
    if (!isOpen) content.classList.add('show');
};

window.renameCategory = async (oldName) => {
    const newName = prompt("أدخل الاسم الجديد للقسم:", oldName);
    if (!newName || newName === oldName) return;
    if (!confirm(`متأكد من تغيير الاسم؟ سيتم نقل جميع المنتجات المرتبطة إلى (${newName}) تلقائياً.`)) return;

    try {
        showToast("جاري التحديث ونقل المنتجات...");
        const catDoc = await db.collection("categories").doc(oldName).get();
        if (!catDoc.exists) return;

        await db.collection("categories").doc(newName).set(catDoc.data());

        const productsSnap = await db.collection("products").where("mainCategory", "==", oldName).get();
        const batch = db.batch();
        productsSnap.forEach(doc => {
            batch.update(doc.ref, { mainCategory: newName });
        });
        await batch.commit();

        await db.collection("categories").doc(oldName).delete();

        showToast("تم تحديث الاسم والمنتجات بنجاح ✅");
        init();
    } catch (error) { console.error(error); showToast("حدث خطأ ❌"); }
};

window.saveInventory = async () => {
    const id = document.getElementById('invId').value;
    const name = document.getElementById('invName').value.trim();
    const priceBefore = document.getElementById('invPriceBefore').value;
    const priceAfter = document.getElementById('invPriceAfter').value;
    const matte = document.getElementById('invMatte').checked;
    const glossy = document.getElementById('invGlossy').checked;
    const widthIn = document.getElementById('invWidthIn').value;
    const heightIn = document.getElementById('invHeightIn').value;

    if(!name) return alert("يرجى إدخال اسم المخزون");
    const data = {
        name, priceBefore, priceAfter, widthIn, heightIn, matte, glossy,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        if(id) {
            await db.collection('inventory').doc(id).update(data);
            showToast("تم تحديث المخزون ✅");
        } else {
            await db.collection('inventory').add(data);
            showToast("تمت إضافة المخزون ✅");
        }
        clearInvForm();
        loadInventory();
    } catch(e) {
        alert("خطأ في حفظ المخزون!");
    }
};

window.clearInvForm = () => {
    document.getElementById('invId').value = '';
    document.getElementById('invName').value = '';
    document.getElementById('invPriceBefore').value = '';
    document.getElementById('invPriceAfter').value = '';
    document.getElementById('invWidthIn').value = '';
    document.getElementById('invHeightIn').value = '';
    document.getElementById('invMatte').checked = false;
    document.getElementById('invGlossy').checked = false;
};

window.loadInventory = async () => {
    const snap = await db.collection('inventory').orderBy('timestamp', 'desc').get();
    const list = document.getElementById('inventoryList');
    let html = '';
    
    if(snap.empty) {
        list.innerHTML = '<div style="text-align: center; color: #888; padding: 20px;">لا توجد عناصر في المخزون حالياً</div>';
        return;
    }

    snap.forEach(doc => {
        const d = doc.data();
        const safeName = d.name ? d.name.replace(/'/g, "\\'") : '';
        
        html += `
            <div class="list-item" style="flex-direction: column; background: #1a1a1a;">
                <div style="display:flex; justify-content:space-between; width:100%; align-items: center;">
                    <strong style="color:var(--primary); font-size:16px;">${d.name}</strong>
                    <div style="display: flex; gap: 8px;">
                        <button class="save-btn" style="padding:6px 12px; font-size:12px; background: #444;" onclick="editInv('${doc.id}', '${safeName}', '${d.priceBefore||''}', '${d.priceAfter||''}', '${d.widthIn||''}', '${d.heightIn||''}', ${d.matte||false}, ${d.glossy||false})">تعديل ✏️</button>
                        <button class="danger-btn" style="padding:6px 12px; font-size:12px;" onclick="deleteInv('${doc.id}')">حذف 🗑️</button>
                    </div>
                </div>
                <div style="color:#aaa; font-size:14px; margin-top:8px; display: flex; flex-wrap: wrap; gap: 15px;">
                    <span>💰 السعر: <del style="color:#666;">${d.priceBefore || '-'}</del> <span style="color:#fff; font-weight:bold;">${d.priceAfter || '-'}</span> ر.س</span>
                    <span>📏 المقاس: <span style="color:#fff;">${d.widthIn} × ${d.heightIn} إنش</span></span>
                    <span>✨ اللمسة: ${d.matte ? 'مطفي ✅' : 'مطفي ❌'} | ${d.glossy ? 'لامع ✅' : 'لامع ❌'}</span>
                </div>
            </div>
        `;
    });
    list.innerHTML = html;
};

window.editInv = (id, name, pb, pa, wIn, hIn, m, g) => {
    document.getElementById('invId').value = id;
    document.getElementById('invName').value = name;
    document.getElementById('invPriceBefore').value = pb;
    document.getElementById('invPriceAfter').value = pa;
    document.getElementById('invWidthIn').value = wIn;
    document.getElementById('invHeightIn').value = hIn;
    document.getElementById('invMatte').checked = m;
    document.getElementById('invGlossy').checked = g;
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.deleteInv = async (id) => {
    if(confirm("هل أنت متأكد من حذف هذا العنصر من المخزون؟")) {
        await db.collection('inventory').doc(id).delete();
        loadInventory();
    }
};

window.updateSEO = async id => {
    const keys_ar = document.getElementById(`kar_${id}`).value.split('،').map(k => k.trim());
    const keys_en = document.getElementById(`ken_${id}`).value.split(',').map(k => k.trim());
    try {
        await db.collection("products").doc(id).update({
            title_ar: document.getElementById(`tar_${id}`).value, title_en: document.getElementById(`ten_${id}`).value,
            desc_ar: document.getElementById(`dar_${id}`).value, desc_en: document.getElementById(`den_${id}`).value,
            keys_ar: keys_ar, keys_en: keys_en
        }); showToast("تم الحفظ ✅");
    } catch (e) { alert("❌ فشل الحفظ."); }
};

window.saveCat = async () => {
    const name = document.getElementById('catName').value.trim(), order = parseInt(document.getElementById('catOrder').value) || 0, fileInput = document.getElementById('catImageInput');
    if (!name) return alert("يرجى إدخال اسم القسم");
    let imageUrl = "";
    if (fileInput.files.length > 0) { imageUrl = await uploadToStorage(fileInput.files[0], `cat_${name}.jpg`); }
    await db.collection("categories").doc(name).set({ order, imageUrl, subs: [] }, { merge: true });
    location.reload();
};

window.updateCatImage = async (id, inputElem) => {
    if (!inputElem.files || inputElem.files.length === 0) return;
    const imageUrl = await uploadToStorage(inputElem.files[0], `cat_edit_${id}.jpg`);
    await db.collection("categories").doc(id).update({ imageUrl }); init();
};

window.toggleInlineEdit = (id) => { const el = document.getElementById(`edit_ui_${id}`); el.style.display = el.style.display === 'block' ? 'none' : 'block'; };

window.updateSubCatFull = async (main, oldSub) => {
    const newSub = document.getElementById(`in_name_${oldSub}`).value.trim(), newMain = document.getElementById(`in_main_${oldSub}`).value;
    if (!newSub) return; const batch = db.batch();
    const prods = await db.collection("products").where("mainCategory", "==", main).where("subCategory", "==", oldSub).get();
    prods.forEach(doc => batch.update(doc.ref, { mainCategory: newMain, subCategory: newSub }));
    const oldRef = db.collection("categories").doc(main); const oldDoc = await oldRef.get();
    await oldRef.update({ subs: oldDoc.data().subs.filter(s => s !== oldSub) });
    const newRef = db.collection("categories").doc(newMain); const newDoc = await newRef.get();
    let newSubs = newDoc.data().subs || []; if (!newSubs.includes(newSub)) newSubs.push(newSub);
    await newRef.update({ subs: newSubs }); await batch.commit(); init();
};

window.deleteSubCat = async (main, sub) => {
    if (confirm(`حذف [${sub}]؟`)) {
        const prods = await db.collection("products").where("mainCategory", "==", main).where("subCategory", "==", sub).get();
        const batch = db.batch(); prods.forEach(doc => batch.delete(doc.ref)); await batch.commit();
        const catRef = db.collection("categories").doc(main); const catDoc = await catRef.get();
        await catRef.update({ subs: (catDoc.data().subs || []).filter(s => s !== sub) }); init();
    }
};

window.loadSubCats = (mId, sId) => {
    const m = document.getElementById(mId).value, s = document.getElementById(sId);
    s.innerHTML = '<option value="">(بدون فرعي)</option>';
    if (siteCats[m]?.subs) siteCats[m].subs.forEach(sub => s.innerHTML += `<option value="${sub}">${sub}</option>`);
};

window.switchTab = (e, id) => { 
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active')); 
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active')); 
    document.getElementById(id).classList.add('active'); 
    e.target.classList.add('active'); 
};

window.toggleAll = c => document.querySelectorAll('.prod-cb').forEach(x => x.checked = c.checked);

window.bulkDelete = async () => { const sels = document.querySelectorAll('.prod-cb:checked'); if (sels.length && confirm(`حذف ${sels.length}؟`)) { for (let x of sels) await db.collection("products").doc(x.value).delete(); init(); } };

window.addSubCat = async (main) => { const sub = prompt("اسم التصنيف الفرعي الجديد:"); if (!sub) return; const doc = await db.collection("categories").doc(main).get(); let subs = doc.data().subs || []; subs.push(sub.trim()); await db.collection("categories").doc(main).update({ subs }); init(); };

window.deleteMainCat = async (id) => { if (confirm(`حذف القسم [${id}] نهائياً؟`)) { await db.collection("categories").doc(id).delete(); init(); } };