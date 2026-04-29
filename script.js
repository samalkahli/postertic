const firebaseConfig = {
    apiKey: "AIzaSyCJWBVYry9VNnxCKynEcxOi5PoKqJjzJWI",
    authDomain: "postertic-bc971.firebaseapp.com",
    projectId: "postertic-bc971",
    storageBucket: "postertic-bc971.firebasestorage.app"
};
firebase.initializeApp(firebaseConfig);
firebase.firestore().enablePersistence().catch(function (err) { console.log("Caching error:", err); });
const db = firebase.firestore();

let allProducts = [], categoriesData = {};
window.inventoryList = []; 
window.globalInventory = null;

let currentMainCat = 'الكل', currentSubCat = 'الكل';
let currentImgUrl = "", currentImgTitle = "", currentImgId = "";
let cart = JSON.parse(localStorage.getItem('postertic_cart')) || [];

// --- تهيئة الـ PWA والتثبيت ---
let deferredPrompt;
const installBtn = document.getElementById('installAppBtn');

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(()=>{}); });
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

if(installBtn) {
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') installBtn.style.display = 'none';
            deferredPrompt = null;
        } else {
            showToast("للتثبيت 📱: من المتصفح اضغط زر المشاركة ثم اختر 'إضافة للشاشة الرئيسية'");
        }
    });
}

// --- تأثيرات الهيدر عند السكرول ---
window.addEventListener('scroll', () => {
    const header = document.getElementById('floatingHeader');
    if(header) {
        if (window.scrollY > 60) header.classList.add('scrolled');
        else header.classList.remove('scrolled');
    }
});

// --- التحكم بالنافذة (Lightbox) والسحب للإغلاق ---
const lb = document.getElementById('lightbox');
const imgWrapper = document.getElementById('imgWrapper');
const lbControls = document.getElementById('lbControls');
let startY = 0, currentY = 0, isDragging = false;

if(imgWrapper) {
    imgWrapper.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        isDragging = true;
        imgWrapper.style.transition = 'none';
    }, {passive: true});

    imgWrapper.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentY = e.touches[0].clientY;
        const diff = currentY - startY;
        if (diff > 0) {
            e.preventDefault(); 
            imgWrapper.style.transform = `translateY(${diff}px) scale(${1 - diff/2000})`;
            lb.style.backgroundColor = `rgba(14, 15, 15, ${Math.max(0, 0.98 - diff/500)})`;
            lbControls.style.opacity = Math.max(0, 1 - diff/150);
        }
    }, {passive: false});

    imgWrapper.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;
        imgWrapper.style.transition = 'transform 0.3s ease';
        const diff = currentY - startY;
        if (diff > 120) window.history.back();
        else {
            imgWrapper.style.transform = 'translateY(0) scale(1)';
            lb.style.backgroundColor = 'rgba(14, 15, 15, 0.98)';
            lbControls.style.opacity = '1';
        }
    });
}

// --- إدارة التوجيه (Routing) ---
window.addEventListener('popstate', (event) => {
    const urlParams = new URLSearchParams(window.location.search);
    const cat = urlParams.get('cat');
    const product = urlParams.get('product');

    if (!product && document.getElementById('lightbox')?.classList.contains('active')) {
        document.getElementById('lightbox').classList.remove('active');
        imgWrapper.style.transform = ''; lb.style.backgroundColor = ''; lbControls.style.opacity = '1';
        return;
    }
    if (cat && categoriesData[cat]) {
        currentMainCat = cat;
        document.getElementById('home-section').style.display = 'none';
        document.getElementById('productsView').style.display = 'block';
        document.getElementById('catTitle').innerText = cat;
        currentSubCat = 'الكل'; updateSubCatUI(); applyFilters();
    } else if (!product) {
        document.getElementById('productsView').style.display = 'none';
        document.getElementById('home-section').style.display = 'block';
    }
});

// --- وظائف الجلب والفلترة ---
async function initStore() {
    try {
        const catSnap = await db.collection("categories").get();
        let catsArr = []; catSnap.forEach(doc => catsArr.push({ id: doc.id, ...doc.data() }));
        catsArr.sort((a, b) => (a.order || 0) - (b.order || 0));
        let homeHtml = '';
        catsArr.forEach(c => {
            categoriesData[c.id] = c;
            homeHtml += `<div class="cat-card" onclick="openCategory('${c.id}')"><img src="${c.imageUrl}" loading="lazy"><div class="cat-overlay"><h2 style="font-size: 1.2rem">${c.id}</h2></div></div>`;
        });
        document.getElementById('homeGrid').innerHTML = homeHtml;
        document.getElementById('loader').style.display = 'none';

        const invSnap = await db.collection("inventory").orderBy("timestamp", "desc").get();
        window.inventoryList = []; invSnap.forEach(doc => window.inventoryList.push({ id: doc.id, ...doc.data() }));
        if (window.inventoryList.length > 0) window.globalInventory = window.inventoryList[0];

        db.collection("products").get().then(prodSnap => {
            allProducts = prodSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const urlParams = new URLSearchParams(window.location.search);
            const sharedCat = urlParams.get('cat');
            const sharedProduct = urlParams.get('product');
            if (sharedProduct) {
                const prod = allProducts.find(p => p.id === sharedProduct);
                if(prod) { if(prod.mainCategory) openCategory(prod.mainCategory); openLightbox(prod.id, prod.imageUrl, (prod.title_ar || "").replace(/'/g, "\\'")); }
            } else if (sharedCat && categoriesData[sharedCat]) openCategory(sharedCat);
            else document.getElementById('home-section').style.display = 'block';
        });
        updateCartUI();
    } catch (error) { document.getElementById('loader').innerHTML = 'خطأ في جلب البيانات'; }
}

function updateSubCatUI() {
    const nav = document.getElementById('catsNav');
    if (!categoriesData[currentMainCat]?.subs) { nav.innerHTML = ''; return; }
    const allSubs = categoriesData[currentMainCat].subs;
    let navHtml = `<button class="sub-btn ${currentSubCat === 'الكل' ? 'active' : ''}" onclick="filterBySub('الكل')">الكل</button>`;
    allSubs.forEach(s => navHtml += `<button class="sub-btn ${currentSubCat === s ? 'active' : ''}" onclick="filterBySub('${s}')">${s}</button>`);
    nav.innerHTML = navHtml;
}

window.openCategory = (mainCat) => {
    currentMainCat = mainCat; document.getElementById('home-section').style.display = 'none';
    document.getElementById('productsView').style.display = 'block';
    document.getElementById('catTitle').innerText = mainCat;
    window.history.pushState({}, '', '?cat=' + encodeURIComponent(mainCat));
    currentSubCat = 'الكل'; updateSubCatUI(); applyFilters();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.filterBySub = (sub) => { currentSubCat = sub; updateSubCatUI(); applyFilters(); };

function applyFilters() {
    const term = document.getElementById('searchInput').value.toLowerCase().trim();
    const filtered = allProducts.filter(p => {
        const inTitle = (p.title_ar || "").toLowerCase().includes(term);
        const matchMain = currentMainCat === 'الكل' || p.mainCategory === currentMainCat;
        const matchSub = currentSubCat === 'الكل' || p.subCategory === currentSubCat;
        return inTitle && matchMain && matchSub;
    });
    renderProducts(filtered);
}

// --- عرض المنتجات (الكروت الخارجية بدون مقاسات) ---
function renderProducts(products) {
    const gallery = document.getElementById('galleryGrid');
    if (products.length === 0) { gallery.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:50px;">لا توجد نتائج</div>'; return; }
    let html = '';
    products.forEach(p => {
        const title = p.title_ar || "لوحة بوسترتيك";
        const cleanTitleStr = title.replace(/'/g, "\\'");
        const inv = window.globalInventory;
        let subTitle = title.replace(/لوحة بوسترتي?ك المعدنية/g, "").trim();

        let priceHtml = '';
        if (inv) {
            let discountBadge = (inv.priceBefore > inv.priceAfter) ? `<span style="background:rgba(239,68,68,0.1); color:var(--danger); padding:2px 6px; border-radius:12px; font-size:9px; margin-right:5px;">-${Math.round(((inv.priceBefore-inv.priceAfter)/inv.priceBefore)*100)}%</span>` : '';
            priceHtml = `<div class="price-row" style="margin-bottom:12px;"><span class="price-after">${inv.priceAfter} <img src="https://www.sama.gov.sa/ar-sa/Currency/Documents/Saudi_Riyal_Symbol-2.svg" class="riyal-icon" style="height:1em; filter:brightness(0) invert(73%) sepia(19%) saturate(1008%) hue-rotate(345deg) brightness(91%) contrast(89%);"></span>${inv.priceBefore ? `<span class="price-before" style="font-size:11px; margin-right:5px;">${inv.priceBefore}</span>` : ''}${discountBadge}</div>`;
        }

        // الأزرار الخارجية تفتح اللوحة عشان يختار المقاس براحته
        html += `<div class="product-card">
            <div class="card-image" onclick="openLightbox('${p.id}', '${p.imageUrl}', '${cleanTitleStr}')"><img src="${p.imageUrl}" loading="lazy"></div>
            <div class="card-body">
                <h3 class="card-title" onclick="openLightbox('${p.id}', '${p.imageUrl}', '${cleanTitleStr}')"><span style="display:block; font-size:13px; color:#888; font-weight:normal; margin-bottom:4px;">لوحة بوسترتيك المعدنية</span><span style="display:block; font-size:14px; color:var(--text-main);">${subTitle}</span></h3>
                ${priceHtml}
                <div class="card-actions-row">
                    <button onclick="openLightbox('${p.id}', '${p.imageUrl}', '${cleanTitleStr}')" class="cart-btn" style="flex:2;">🛒 اختيار المقاس</button>
                    <button onclick="openLightbox('${p.id}', '${p.imageUrl}', '${cleanTitleStr}')" class="cart-btn wa-btn" style="flex:1;"><i class="sicon-whatsapp2"></i></button>
                </div>
            </div>
        </div>`;
    });
    gallery.innerHTML = html;
}

// --- إدارة السلة ---
window.toggleCart = () => { document.getElementById('cartDrawer').classList.toggle('open'); document.getElementById('cartOverlay').classList.toggle('open'); };
window.addToCart = (id, title, imgUrl, effect, sizeName, price) => { cart.push({ id, title, imgUrl, effect, sizeName, price }); localStorage.setItem('postertic_cart', JSON.stringify(cart)); updateCartUI(); showToast("تمت الإضافة للسلة 🛒"); };
window.removeFromCart = (i) => { cart.splice(i, 1); localStorage.setItem('postertic_cart', JSON.stringify(cart)); updateCartUI(); };

function updateCartUI() {
    document.getElementById('cartBadgeCount').innerText = cart.length;
    const container = document.getElementById('cartItemsContainer');
    if (cart.length === 0) { container.innerHTML = '<div class="empty-cart-msg">سلتك فارغة</div>'; return; }
    container.innerHTML = cart.map((item, index) => {
        let cleanItemTitle = item.title.replace(/لوحة بوسترتي?ك المعدنية/g, "").trim();
        return `<div class="cart-item"><img src="${item.imgUrl}"><div class="cart-item-info"><h4 class="cart-item-title"><span style="display:block; font-size:11px; color:#888; font-weight:normal;">لوحة بوسترتيك المعدنية</span>${cleanItemTitle}</h4><div style="font-size:12px; color:#888; margin-bottom:5px;">المقاس: ${item.sizeName} | اللمسة: ${item.effect}</div><div style="font-size:14px; font-weight:bold; color:var(--primary-color);">${item.price} ريال</div></div><button class="delete-item" onclick="removeFromCart(${index})"><i class="sicon-trash"></i></button></div>`;
    }).join('');
}

// --- إتمام الطلب والربط مع سلة (Salla) ---
window.checkoutToStore = () => {
    if (cart.length === 0) { alert("السلة فارغة!"); return; }
    
    const sallaData = cart.map(item => ({
        t: item.title,
        s: item.sizeName,
        e: item.effect,
        i: item.imgUrl
    }));

    const encodedData = encodeURIComponent(JSON.stringify(sallaData));
    const checkoutBtn = document.querySelector('.checkout-btn[onclick="checkoutToStore()"]');
    if(checkoutBtn) {
        checkoutBtn.innerHTML = '<i class="sicon-spinner spinner"></i> جاري التحويل للمتجر...';
        checkoutBtn.style.pointerEvents = 'none';
    }

    window.location.href = `https://postertic.com/?import_cart=${encodedData}`;
};

// --- نافذة اللوحة (المقاسات كأزرار دائرية) ---
window.openLightbox = (id, url, title) => {
    currentImgId = id; currentImgUrl = url; currentImgTitle = title;
    document.getElementById('preview-img').src = url;
    const sizeContainer = document.getElementById('lbSizeContainer');
    if (sizeContainer && window.inventoryList.length > 0) {
        sizeContainer.innerHTML = window.inventoryList.map((inv, idx) => `<button class="size-pill ${idx === 0 ? 'active' : ''}" onclick="updateLightboxOptions('${inv.name}', this)">${inv.name}</button>`).join('');
        updateLightboxOptions(window.inventoryList[0].name);
    }
    document.getElementById('lightbox').classList.add('active');
    window.history.pushState({productId: id}, '', '?product=' + id);
};

window.updateLightboxOptions = (sizeName, btn) => {
    const inv = window.inventoryList.find(i => i.name === sizeName); if (!inv) return;
    if (btn) { document.querySelectorAll('.size-pill').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }
    document.getElementById('lbSizeContainer').dataset.selectedSize = sizeName;
    const priceDisp = document.getElementById('lbPriceDisplay');
    priceDisp.innerHTML = `${inv.priceAfter} <img src="https://www.sama.gov.sa/ar-sa/Currency/Documents/Saudi_Riyal_Symbol-2.svg" class="riyal-icon" style="height:1.1em; vertical-align:text-bottom; filter:brightness(0) invert(73%) sepia(19%) saturate(1008%) hue-rotate(345deg) brightness(91%) contrast(89%);">`;
    const toggles = document.getElementById('lbEffectToggles'); toggles.innerHTML = '';
    if (inv.matte) toggles.innerHTML += `<button class="eff-btn" onclick="setEffect('matte', this)">مطفي</button>`;
    if (inv.glossy) toggles.innerHTML += `<button class="eff-btn" onclick="setEffect('glossy', this)">لامع</button>`;
    const firstEff = toggles.querySelector('.eff-btn'); if (firstEff) firstEff.click();
};

window.setEffect = (type, btn) => {
    document.querySelectorAll('#lbEffectToggles .eff-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.getElementById('imgWrapper').className = 'img-container ' + (type === 'glossy' ? 'effect-glossy' : 'effect-matte');
};

window.addPreviewToCart = () => {
    const effect = document.getElementById('imgWrapper').classList.contains('effect-glossy') ? "لامع" : "مطفي";
    const selectedSize = document.getElementById('lbSizeContainer').dataset.selectedSize;
    const inv = window.inventoryList.find(i => i.name === selectedSize);
    addToCart(currentImgId, currentImgTitle, currentImgUrl, effect, selectedSize, inv.priceAfter);
    window.history.back(); 
};

window.orderPreviewWA = () => {
    const effect = document.getElementById('imgWrapper').classList.contains('effect-glossy') ? "لامع" : "مطفي";
    const selectedSize = document.getElementById('lbSizeContainer').dataset.selectedSize;
    const inv = window.inventoryList.find(i => i.name === selectedSize);
    const msg = `أهلاً بوسترتيك 👋\nحاب أطلب:\nاللوحة: ${currentImgTitle}\nالمقاس: ${selectedSize}\nاللمسة: ${effect}\nالسعر: ${inv.priceAfter} ريال`;
    window.open(`https://wa.me/966575050509?text=${encodeURIComponent(msg)}`, '_blank');
};

function showToast(m) { const t = document.getElementById('toast'); t.innerText = m; t.style.display = 'block'; setTimeout(() => t.style.display = 'none', 2500); }
window.closeLightbox = () => window.history.back();
window.handleSearch = () => { if (document.getElementById('home-section').style.display === 'block') openCategory('الكل'); applyFilters(); };

if(document.readyState === 'loading') window.addEventListener('DOMContentLoaded', initStore); else initStore();
