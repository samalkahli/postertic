const firebaseConfig = {
    apiKey: "AIzaSyCJWBVYry9VNnxCKynEcxOi5PoKqJjzJWI",
    authDomain: "postertic-bc971.firebaseapp.com",
    projectId: "postertic-bc971",
    storageBucket: "postertic-bc971.firebasestorage.app"
};
if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }
firebase.firestore().enablePersistence().catch(function (err) { console.log("Caching error:", err); });
const db = firebase.firestore();

// --- متغيرات التحميل التدريجي (Pagination) ---
let lastVisible = null; 
let isFetching = false; 
const PAGE_LIMIT = 20;  
let hasMore = true;     
let allProducts = []; 

let categoriesData = {};
window.inventoryList = []; 
window.globalInventory = null;

let currentMainCat = 'الكل', currentSubCat = 'الكل';
let currentImgUrl = "", currentImgTitle = "", currentImgId = "";
let cart = JSON.parse(localStorage.getItem('postertic_cart')) || [];

const riyal = `<span class="sar-symbol">ر.س</span>`;

// --- PWA والتثبيت ---
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
            showToast("للتثبيت 📱: اضغط زر المشاركة أسفل المتصفح، ثم اختر 'إضافة للشاشة الرئيسية' ➕");
        }
    });
}

window.addEventListener('scroll', () => {
    const header = document.getElementById('floatingHeader');
    if(header) {
        if (window.scrollY > 60) header.classList.add('scrolled');
        else header.classList.remove('scrolled');
    }
});

window.addEventListener('click', (e) => {
    if(!e.target.closest('.cart-size-btn')) {
        document.querySelectorAll('[id^="cartSizeDrop_"]').forEach(el => el.classList.remove('show'));
    }
    const popup = document.getElementById('sizePopup');
    if(popup && !e.target.closest('svg')) popup.style.display = 'none';

    const dropdown = document.getElementById('subCatsDropdown');
    if(dropdown && dropdown.classList.contains('show') && !e.target.closest('#moreSubsBtn')) {
        dropdown.classList.remove('show');
    }
});

window.addEventListener('scroll', () => { 
    const popup = document.getElementById('sizePopup');
    if(popup) popup.style.display = 'none'; 
}, true);

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
        
        if (diff > 120) window.closeLightbox();
        else {
            imgWrapper.style.transform = 'translateY(0) scale(1)';
            lb.style.backgroundColor = 'rgba(14, 15, 15, 0.98)';
            lbControls.style.opacity = '1';
        }
    });
}

window.addEventListener('popstate', (event) => {
    const urlParams = new URLSearchParams(window.location.search);
    const cat = urlParams.get('cat');
    const product = urlParams.get('product');

    if (!product && document.getElementById('lightbox')?.classList.contains('active')) {
        document.getElementById('lightbox').classList.remove('active');
        imgWrapper.style.transform = ''; 
        lb.style.backgroundColor = '';
        lbControls.style.opacity = '1';
        return;
    }

    if (cat && categoriesData[cat]) {
        currentMainCat = cat;
        if(document.getElementById('home-section')) document.getElementById('home-section').style.display = 'none';
        if(document.getElementById('productsView')) document.getElementById('productsView').style.display = 'block';
        if(document.getElementById('catTitle')) document.getElementById('catTitle').innerText = cat;
        updateSubCatUI();
        resetPagination();
        fetchProducts();
    } else if (!product) {
        if(document.getElementById('productsView')) document.getElementById('productsView').style.display = 'none';
        if(document.getElementById('home-section')) document.getElementById('home-section').style.display = 'block';
    }
});

// --- السرعة الصاروخية: الفتح الفوري والفحص بالخلفية ---
async function initStore() {
    try {
        const invSnap = await db.collection("inventory").orderBy("timestamp", "desc").get();
        window.inventoryList = [];
        invSnap.forEach(doc => { window.inventoryList.push({ id: doc.id, ...doc.data() }); });
        if (window.inventoryList.length > 0) window.globalInventory = window.inventoryList[0];

        const catSnap = await db.collection("categories").get();
        let catsArr = [];
        catSnap.forEach(doc => { catsArr.push({ id: doc.id, ...doc.data() }); });
        catsArr.sort((a, b) => (a.order || 0) - (b.order || 0));

        let homeHtml = '';
        
        // 1. عرض كل الأقسام فوراً بدون انتظار (لضمان سرعة المتجر)
        catsArr.forEach(c => {
            categoriesData[c.id] = c;
            c.validSubs = c.subs || []; // نفترض مبدئياً أن كل الأقسام الفرعية صالحة
            const safeId = c.id.replace(/\s+/g, '_'); // معرّف آمن للقسم
            homeHtml += `
                <div class="cat-card" id="cat_card_${safeId}" onclick="openCategory('${c.id}')">
                    <img src="${c.imageUrl}" loading="lazy">
                    <div class="cat-overlay"><h2 style="font-size: 1.2rem">${c.id}</h2></div>
                </div>`;
        });
        
        if(document.getElementById('homeGrid')) document.getElementById('homeGrid').innerHTML = homeHtml;
        if(document.getElementById('loader')) document.getElementById('loader').style.display = 'none'; // فتح المتجر فوراً!

        // 2. الفحص الذكي بالخلفية: إخفاء الأقسام الفارغة بصمت
        catsArr.forEach(c => {
            (async () => {
                try {
                    const checkProd = await db.collection("products").where("mainCategory", "==", c.id).limit(1).get();
                    if (checkProd.empty) {
                        // إخفاء القسم بصمت لأنه فارغ
                        const safeId = c.id.replace(/\s+/g, '_');
                        const cardElement = document.getElementById(`cat_card_${safeId}`);
                        if (cardElement) cardElement.style.display = 'none';
                        categoriesData[c.id].validSubs = []; 
                    } else {
                        // إذا القسم الرئيسي فيه منتجات، نفحص الفرعية بالخلفية
                        if (c.subs && c.subs.length > 0) {
                            let validSubs = [];
                            await Promise.all(c.subs.map(async (s) => {
                                try {
                                    const subCheck = await db.collection("products").where("subCategory", "==", s).limit(1).get();
                                    if (!subCheck.empty) validSubs.push(s);
                                } catch(e) { validSubs.push(s); } // احتياطياً في حال تعذر الفحص
                            }));
                            categoriesData[c.id].validSubs = validSubs;
                            
                            // تحديث القائمة فوراً لو كان العميل داخل القسم
                            if (currentMainCat === c.id) updateSubCatUI();
                        }
                    }
                } catch(e) {}
            })();
        });

        // 3. معالجة الروابط المشتركة والسلة
        const urlParams = new URLSearchParams(window.location.search);
        const shortCartId = urlParams.get('c');
        const sharedCat = urlParams.get('cat');
        const sharedProduct = urlParams.get('product');

        if (shortCartId) {
            try {
                const docRef = await db.collection("shared_carts").doc(shortCartId).get();
                if (docRef.exists) {
                    cart = docRef.data().items;
                    localStorage.setItem('postertic_cart', JSON.stringify(cart));
                    if(document.getElementById('cartDrawer')) document.getElementById('cartDrawer').classList.add('open');
                    if(document.getElementById('cartOverlay')) document.getElementById('cartOverlay').classList.add('open');
                    window.history.replaceState({}, document.title, window.location.pathname);
                    setTimeout(() => showToast("تم استعادة السلة بنجاح! 🛒"), 500);
                }
            } catch (e) { console.error("Error fetching cart:", e); }
        }

        if (sharedProduct) {
            const prodDoc = await db.collection("products").doc(sharedProduct).get();
            if(prodDoc.exists) {
                const prod = { id: prodDoc.id, ...prodDoc.data() };
                if(prod.mainCategory) openCategory(prod.mainCategory); 
                openLightbox(prod.id, prod.imageUrl, (prod.title_ar || "").replace(/'/g, "\\'"));
            }
        } else if (!shortCartId && sharedCat && categoriesData[sharedCat]) { 
            openCategory(sharedCat); 
        } else if (!shortCartId) { 
            if(document.getElementById('home-section')) document.getElementById('home-section').style.display = 'block'; 
        }

        updateCartUI();

    } catch (error) { 
        console.error(error);
        if(document.getElementById('loader')) document.getElementById('loader').innerHTML = '<p style="color:red; text-align:center;">حدث خطأ في جلب البيانات.</p>'; 
    }
}

// --- دوال التحميل التدريجي (Pagination) ---
function resetPagination() {
    lastVisible = null;
    hasMore = true;
    allProducts = []; 
    const grid = document.getElementById('galleryGrid');
    if(grid) grid.innerHTML = '';
}
function shuffleArray(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}
async function fetchProducts() {
    if (isFetching || !hasMore) return;
    isFetching = true;

    const grid = document.getElementById('galleryGrid');
    let loadBtn = document.getElementById('loadMoreBtn');
    
    if (!loadBtn && grid) {
        loadBtn = document.createElement('button');
        loadBtn.id = 'loadMoreBtn';
        loadBtn.className = 'cart-btn';
        loadBtn.style.cssText = 'grid-column: 1/-1; margin: 20px auto; padding: 12px 30px; display: none; width: fit-content;';
        loadBtn.onclick = fetchProducts;
        grid.after(loadBtn);
    }
    
    if(loadBtn) {
        loadBtn.style.display = 'block';
        loadBtn.innerText = '⏳ جاري التحميل...';
    }

    try {
        let query = db.collection("products");
        
        if (currentMainCat !== 'الكل') query = query.where("mainCategory", "==", currentMainCat);
        if (currentSubCat !== 'الكل') query = query.where("subCategory", "==", currentSubCat);
        
        if (lastVisible) query = query.startAfter(lastVisible);
        query = query.limit(PAGE_LIMIT);

        const snap = await query.get();

        if (snap.empty) {
            hasMore = false;
            if (grid.innerHTML === '') grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #888; padding: 50px;">لا توجد لوحات حالياً في هذا القسم</div>';
            if (loadBtn) loadBtn.style.display = 'none';
            isFetching = false;
            return;
        }

        lastVisible = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < PAGE_LIMIT) hasMore = false;

        const newProducts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        allProducts = [...allProducts, ...newProducts]; 

        // --- التعديل هنا: خلط الدفعة عشوائياً قبل عرضها ---
        const shuffledProducts = shuffleArray([...newProducts]);
        renderProductsBatch(shuffledProducts);

        if (loadBtn) {
            loadBtn.innerText = 'عرض المزيد من اللوحات ▼';
            loadBtn.style.display = hasMore ? 'block' : 'none';
        }

    } catch (error) {
        console.error("Error fetching products:", error);
        if (loadBtn) loadBtn.innerText = '❌ حدث خطأ، حاول مرة أخرى';
    } finally {
        isFetching = false;
    }
}

window.goHome = () => {
    document.getElementById('productsView').style.display = 'none';
    document.getElementById('home-section').style.display = 'block';
    document.getElementById('searchInput').value = '';
    window.history.pushState({}, '', window.location.pathname);
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// --- واجهة الأقسام الفرعية (تعتمد على validSubs المصفاة بالخلفية) ---
function updateSubCatUI() {
    const nav = document.getElementById('catsNav');
    const dropdown = document.getElementById('subCatsDropdown');
    
    if (!categoriesData[currentMainCat] || !categoriesData[currentMainCat].validSubs || categoriesData[currentMainCat].validSubs.length === 0) {
        nav.innerHTML = ''; 
        if(dropdown) { dropdown.innerHTML = ''; dropdown.classList.remove('show'); }
        return;
    }

    const activeSubs = categoriesData[currentMainCat].validSubs;

    let maxVisible = 4;
    if (window.innerWidth < 450) maxVisible = 1;
    else if (window.innerWidth < 600) maxVisible = 2;
    else if (window.innerWidth < 900) maxVisible = 3;
    
    let visibleSubs = [];
    if (currentSubCat !== 'الكل' && activeSubs.includes(currentSubCat)) {
        visibleSubs.push(currentSubCat);
    }
    
    for (let s of activeSubs) {
        if (visibleSubs.length >= maxVisible) break; 
        if (!visibleSubs.includes(s)) visibleSubs.push(s);
    }
    
    let navHtml = `<button class="sub-btn ${currentSubCat === 'الكل' ? 'active' : ''}" onclick="filterBySub('الكل', true)">الكل</button>`;
    
    activeSubs.forEach(s => {
        if(visibleSubs.includes(s)) {
            navHtml += `<button class="sub-btn ${currentSubCat === s ? 'active' : ''}" onclick="filterBySub('${s}', true)">${s}</button>`;
        }
    });

    if (activeSubs.length > visibleSubs.length) {
        navHtml += `<button class="sub-btn sub-btn-more" id="moreSubsBtn" onclick="toggleDropdown(event)">المزيد ▼</button>`;
    }
    nav.innerHTML = navHtml;

    let dropHtml = `<button class="dropdown-item ${currentSubCat === 'الكل' ? 'active' : ''}" onclick="filterBySub('الكل', true)">الكل</button>`;
    activeSubs.forEach(s => {
        const isActive = currentSubCat === s;
        dropHtml += `<button class="dropdown-item ${isActive ? 'active' : ''}" onclick="filterBySub('${s}', true)">${s}</button>`;
    });
    if(dropdown) dropdown.innerHTML = dropHtml;

    enableMouseScroll(nav);
}

window.toggleDropdown = (e) => {
    e.stopPropagation();
    const d = document.getElementById('subCatsDropdown');
    if(d) d.classList.toggle('show');
};

window.addEventListener('resize', () => { 
    const pv = document.getElementById('productsView');
    if(pv && pv.style.display === 'block') {
        updateSubCatUI(); 
    }
});

function enableMouseScroll(el) {
    let isDown = false; let startX; let scrollLeft;
    el.addEventListener('mousedown', (e) => { 
        isDown = true; el.classList.add('dragging'); 
        startX = e.pageX - el.offsetLeft; 
        scrollLeft = el.scrollLeft; 
    });
    el.addEventListener('mouseleave', () => { isDown = false; el.classList.remove('dragging'); });
    el.addEventListener('mouseup', () => { isDown = false; el.classList.remove('dragging'); });
    el.addEventListener('mousemove', (e) => { 
        if(!isDown) return; 
        e.preventDefault(); 
        const x = e.pageX - el.offsetLeft; 
        const walk = (x - startX) * 2; 
        el.scrollLeft = scrollLeft - walk; 
    });
}

window.openCategory = (mainCat) => {
    currentMainCat = mainCat;
    document.getElementById('home-section').style.display = 'none';
    document.getElementById('productsView').style.display = 'block';
    document.getElementById('catTitle').innerText = mainCat;
    document.getElementById('searchInput').value = '';

    window.history.pushState({}, '', '?cat=' + encodeURIComponent(mainCat));
    currentSubCat = 'الكل'; 
    updateSubCatUI();
    
    resetPagination();
    fetchProducts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.filterBySub = (subCat, fromDropdown = false) => {
    currentSubCat = subCat;
    updateSubCatUI(); 
    if (fromDropdown) {
        const d = document.getElementById('subCatsDropdown');
        if(d) d.classList.remove('show');
    }
    resetPagination();
    fetchProducts();
};

window.handleSearch = () => {
    if (document.getElementById('home-section').style.display === 'block') {
        currentMainCat = 'الكل'; currentSubCat = 'الكل';
        document.getElementById('home-section').style.display = 'none';
        document.getElementById('productsView').style.display = 'block';
        document.getElementById('catTitle').innerText = "نتائج البحث";
        document.getElementById('catsNav').innerHTML = ''; 
        
        resetPagination();
        fetchProducts();
    } else {
        applyFilters();
    }
};

function applyFilters() {
    const searchInput = document.getElementById('searchInput');
    if(!searchInput) return;
    const term = searchInput.value.toLowerCase().trim();
    
    const grid = document.getElementById('galleryGrid');
    const loadBtn = document.getElementById('loadMoreBtn');

    if(term === '') {
        grid.innerHTML = '';
        renderProductsBatch(shuffleArray([...allProducts])); // خلط كل اللوحات عند إفراغ البحث
        if(loadBtn) loadBtn.style.display = hasMore ? 'block' : 'none';
        return;
    }

    let filtered = allProducts.filter(p => {
        const inTitle = (p.title_ar || p.seoTitle || "").toLowerCase().includes(term);
        const matchMain = currentMainCat === 'الكل' || p.mainCategory === currentMainCat;
        const matchSub = currentSubCat === 'الكل' || p.subCategory === currentSubCat;
        return inTitle && matchMain && matchSub;
    });

    grid.innerHTML = '';
    renderProductsBatch(shuffleArray(filtered)); // خلط نتائج البحث
    if(loadBtn) loadBtn.style.display = 'none'; 
}

function renderProductsBatch(products) {
    const gallery = document.getElementById('galleryGrid');
    if (!gallery) return;

    let html = '';
    products.forEach(p => {
        const title = p.title_ar || p.seoTitle || "لوحة بوسترتيك";
        const cleanTitleStr = title.replace(/'/g, "\\'");
        const inv = window.globalInventory;
        
        let priceHtml = '';
        let subTitle = title.replace(/لوحة بوسترتي?ك المعدنية/g, "").trim();

        if (inv) {
            let discountBadge = '';
            if (inv.priceBefore && parseFloat(inv.priceBefore) > parseFloat(inv.priceAfter)) {
                let discountPercent = Math.round(((inv.priceBefore - inv.priceAfter) / inv.priceBefore) * 100);
                discountBadge = `<span style="background: rgba(239, 68, 68, 0.1); color: var(--danger); padding: 2px 8px; border-radius: 22px; font-size: 10px; font-weight: bold; border: 1px solid rgba(239, 68, 68, 0.2);">خصم ${discountPercent}%</span>`;
            }

            priceHtml = `
                <div class="price-row" style="justify-content: center; gap: 8px; margin-bottom: 10px;">
                    <span style="font-size: 13px; color: #888;">السعر:</span>
                    <span class="price-after">${inv.priceAfter} ${riyal}</span>
                    ${inv.priceBefore ? `<span class="price-before" style="font-size:11px; margin-right:5px; text-decoration:line-through; color:#666;">${inv.priceBefore}</span>` : ''}
                    ${discountBadge}
                </div>`;
        }

        html += `
            <div class="product-card">
                <div class="card-image" onclick="openLightbox('${p.id}', '${p.imageUrl}', '${cleanTitleStr}')">
                    <img src="${p.imageUrl}" loading="lazy">
                </div>
                <div class="card-body" style="padding: 15px;">
                    <h3 class="card-title" onclick="openLightbox('${p.id}', '${p.imageUrl}', '${cleanTitleStr}')" style="line-height: 1.5; margin-bottom: 12px; max-height: none;">
                        <span style="display: block; font-size: 13px; color: #888; margin-bottom: 4px;">لوحة بوسترتيك المعدنية</span>
                        <span style="display: block; font-size: 14px; color: var(--primary-color);">${subTitle}</span>
                    </h3>
                    ${priceHtml}
                    <div class="card-actions-row">
                        <button onclick="openLightbox('${p.id}', '${p.imageUrl}', '${cleanTitleStr}')" class="cart-btn" style="flex:2; border-radius: 22px;">
                            🛒 اختيار المقاس
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    gallery.innerHTML += html; 
}

window.toggleCart = () => { 
    const cd = document.getElementById('cartDrawer');
    const co = document.getElementById('cartOverlay');
    if(cd) cd.classList.toggle('open'); 
    if(co) co.classList.toggle('open'); 
};

window.addToCart = (id, title, imgUrl, effect, sizeName, price) => { 
    cart.push({ id, title, imgUrl, effect, sizeName, price }); 
    localStorage.setItem('postertic_cart', JSON.stringify(cart)); 
    updateCartUI(); 
    showToast("تمت الإضافة للسلة بنجاح 🛒"); 
};

window.removeFromCart = (index) => { 
    cart.splice(index, 1); 
    localStorage.setItem('postertic_cart', JSON.stringify(cart)); 
    updateCartUI(); 
};

window.updateItemEffect = (index, newEffect) => { 
    cart[index].effect = newEffect; 
    localStorage.setItem('postertic_cart', JSON.stringify(cart)); 
    updateCartUI(); 
};

window.updateItemSize = (index, newSizeName) => {
    let newInv = window.inventoryList.find(inv => inv.name === newSizeName);
    if(newInv) {
        cart[index].sizeName = newSizeName;
        cart[index].price = newInv.priceAfter;
        if (cart[index].effect === 'مطفي' && !newInv.matte) {
            cart[index].effect = 'لامع'; 
        } else if (cart[index].effect === 'لامع' && !newInv.glossy) {
            cart[index].effect = 'مطفي'; 
        }
        localStorage.setItem('postertic_cart', JSON.stringify(cart));
        updateCartUI();
    }
};

window.toggleCartSizeDropdown = (e, index) => {
    e.stopPropagation();
    document.querySelectorAll('[id^="cartSizeDrop_"]').forEach(el => {
        if(el.id !== `cartSizeDrop_${index}`) el.classList.remove('show');
    });
    const dropdown = document.getElementById(`cartSizeDrop_${index}`);
    if(dropdown) dropdown.classList.toggle('show');
};

window.toggleSizePopup = (e, el, wIn, hIn) => {
    e.stopPropagation();
    const popup = document.getElementById('sizePopup');
    if(!popup) return;
    
    if (popup.style.display === 'block') {
        popup.style.display = 'none';
        return;
    }
    
    if (!wIn || !hIn) {
        popup.innerHTML = 'المقاس غير متوفر';
    } else {
        let wCm = (wIn * 2.54).toFixed(1);
        let hCm = (hIn * 2.54).toFixed(1);
        popup.innerHTML = `📏 <b>الإنش:</b> ${wIn} × ${hIn} <br> 📏 <b>السانتي:</b> ${wCm} × ${hCm}`;
    }
    
    const rect = el.getBoundingClientRect();
    popup.style.top = (rect.top - 60) + 'px';
    popup.style.left = (rect.left + 25) + 'px';
    popup.style.display = 'block';
};

function updateCartUI() {
    const badge = document.getElementById('cartBadgeCount');
    if(badge) badge.innerText = cart.length;
    
    const container = document.getElementById('cartItemsContainer');
    if(!container) return;

    if (cart.length === 0) {
        container.innerHTML = '<div class="empty-cart-msg"><i class="sicon-shopping-bag" style="font-size: 50px; opacity:0.5; display:block; margin-bottom:10px;"></i>سلتك فارغة حالياً</div>';
        return;
    }

    container.innerHTML = cart.map((item, index) => {
        let currentInv = window.inventoryList.find(inv => inv.name === item.sizeName) || window.inventoryList[0];
        let wIn = currentInv && currentInv.widthIn ? currentInv.widthIn : 0;
        let hIn = currentInv && currentInv.heightIn ? currentInv.heightIn : 0;
        
        let sizeOptionsHtml = window.inventoryList.map(inv => `
            <button class="dropdown-item ${item.sizeName === inv.name ? 'active' : ''}" onclick="updateItemSize(${index}, '${inv.name}')">
                ${inv.name} <i class="sicon-check" style="opacity:${item.sizeName === inv.name ? '1' : '0'}"></i>
            </button>
        `).join('');

        let priceBeforeHtml = '';
        let discountBadgeHtml = '';
        if (currentInv && currentInv.priceBefore && parseFloat(currentInv.priceBefore) > parseFloat(currentInv.priceAfter)) {
            let discountPercent = Math.round(((currentInv.priceBefore - currentInv.priceAfter) / currentInv.priceBefore) * 100);
            priceBeforeHtml = `<span style="color:#666; text-decoration:line-through; font-size:11px;">${currentInv.priceBefore}</span>`;
            discountBadgeHtml = `<span style="background: rgba(239, 68, 68, 0.1); color: var(--danger); padding: 2px 6px; border-radius: 12px; font-size: 10px; font-weight: bold;">-${discountPercent}%</span>`;
        }

        let pillsHtml = '';
        if (currentInv) {
            if (currentInv.matte) pillsHtml += `<button class="pill ${item.effect === 'مطفي' ? 'active' : ''}" onclick="updateItemEffect(${index}, 'مطفي')">مطفي</button>`;
            if (currentInv.glossy) pillsHtml += `<button class="pill ${item.effect === 'لامع' ? 'active' : ''}" onclick="updateItemEffect(${index}, 'لامع')">لامع</button>`;
        } else {
            pillsHtml = `
                <button class="pill ${item.effect === 'مطفي' ? 'active' : ''}" onclick="updateItemEffect(${index}, 'مطفي')">مطفي</button>
                <button class="pill ${item.effect === 'لامع' ? 'active' : ''}" onclick="updateItemEffect(${index}, 'لامع')">لامع</button>
            `;
        }

        let cleanItemTitle = item.title.replace(/لوحة بوسترتي?ك المعدنية/g, "").trim();

        return `
        <div class="cart-item">
            <img src="${item.imgUrl}">
            <div class="cart-item-info">
                <h4 class="cart-item-title" style="margin-bottom: 8px; display: block; overflow: visible; white-space: normal; -webkit-line-clamp: unset;">
                    <span style="display: block; font-size: 11px; color: #888; font-weight: normal; margin-bottom: 3px;">لوحة بوسترتيك المعدنية</span>
                    <span style="line-height: 1.5; font-size: 13px;">${cleanItemTitle}</span>
                </h4>
                
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; position:relative;">
                    <span style="font-size: 12px; color: #888;">المقاس:</span>
                    <button class="sub-btn sub-btn-more cart-size-btn" onclick="toggleCartSizeDropdown(event, ${index})" style="padding: 6px 15px; font-size: 12px; min-width: 60px; justify-content: space-between; border-radius: 22px;">
                        ${item.sizeName || 'اختر'} ▼
                    </button>
                    <div id="cartSizeDrop_${index}" class="dropdown-menu" style="top: calc(100% + 2px); right:0; min-width: 120px; padding: 5px;">
                        ${sizeOptionsHtml}
                    </div>
                    <svg onclick="toggleSizePopup(event, this, ${wIn}, ${hIn})" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="cursor:pointer; flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                </div>
                
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                    <span style="font-size: 12px; color: #888;">السعر:</span>
                    <span class="price-after" style="font-size:14px; color:var(--primary-color); font-weight:bold;">${item.price} ${riyal}</span>
                    ${priceBeforeHtml}
                    ${discountBadgeHtml}
                </div>
                
                <div class="effect-pills">
                    ${pillsHtml}
                </div>
            </div>
            <button class="delete-item" onclick="removeFromCart(${index})"><i class="sicon-trash"></i></button>
        </div>
    `}).join('');
}

window.sendShortLinkOrder = async (itemsArray, isInquiry = false) => {
    const btn = isInquiry ? null : document.getElementById('waCheckoutBtn');
    if (btn) { btn.innerText = "جاري التجهيز..."; btn.disabled = true; } else { showToast("⏳ جاري التجهيز..."); }

    try {
        const shortId = Math.random().toString(36).substring(2, 8).toUpperCase();
        await db.collection("shared_carts").doc(shortId).set({ items: itemsArray, createdAt: firebase.firestore.FieldValue.serverTimestamp() });

        let shareableUrl = window.location.origin + window.location.pathname + '?c=' + shortId;
        
        let message = "";
        if (isInquiry) {
            message = `أهلاً بوسترتيك 👋\nحاب استفسر عن:\nالاسم: ${itemsArray[0].title}\nالنوع: ${itemsArray[0].effect}\n${itemsArray[0].sizeName ? 'المقاس: '+itemsArray[0].sizeName+'\n' : ''}${itemsArray[0].price ? 'السعر: '+itemsArray[0].price+' ر.س\n' : ''}🔗 ${shareableUrl}`;
        } else {
            message = `أهلاً بوسترتيك 👋\nحاب أعتمد طلبي:\n🔗 ${shareableUrl}`;
        }

        window.open(`https://wa.me/966575050509?text=${encodeURIComponent(message)}`, '_blank');
    } catch (error) { console.error(error); }

    if (btn) { btn.innerHTML = `<i class="sicon-whatsapp2" style="font-size: 22px;"></i> إتمام الطلب عبر الواتس`; btn.disabled = false; }
};

window.checkoutWhatsApp = () => { if(cart.length > 0) sendShortLinkOrder(cart, false); };

window.checkoutToStore = () => {
    if (cart.length === 0) {
        alert("السلة فارغة!");
        return;
    }

    const sallaData = cart.map(item => ({
        t: item.title,
        s: item.sizeName,
        e: item.effect,
        i: item.imgUrl
    }));

    const encodedData = encodeURIComponent(JSON.stringify(sallaData));
    
    const checkoutBtn = document.querySelector('.checkout-btn[onclick="checkoutToStore()"]');
    if(checkoutBtn) {
        checkoutBtn.dataset.original = checkoutBtn.innerHTML;
        checkoutBtn.innerHTML = '<i class="sicon-spinner spinner"></i> جاري التحويل للمتجر...';
        checkoutBtn.style.pointerEvents = 'none';
    }

    window.location.href = `https://postertic.com/#import_cart=${encodedData}`;
};

window.addEventListener('pageshow', function(event) {
    const checkoutBtn = document.querySelector('.checkout-btn[onclick="checkoutToStore()"]');
    if(checkoutBtn && checkoutBtn.dataset.original) {
        checkoutBtn.innerHTML = checkoutBtn.dataset.original;
        checkoutBtn.style.pointerEvents = 'auto';
    }
});

function showToast(msg) {
    const toast = document.getElementById('toast');
    if(!toast) return;
    toast.innerText = msg; toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

window.openLightbox = (id, url, title) => {
    currentImgId = id; currentImgUrl = url; currentImgTitle = title;
    const pImg = document.getElementById('preview-img');
    if(pImg) pImg.src = url;
    
    const sizeContainer = document.getElementById('lbSizeContainer');
    if (sizeContainer && window.inventoryList && window.inventoryList.length > 0) {
        sizeContainer.innerHTML = window.inventoryList.map((inv, idx) => `
            <button class="size-pill ${idx === 0 ? 'active' : ''}" 
                    onclick="updateLightboxOptions('${inv.name}', this)">
                ${inv.name}
            </button>
        `).join('');
        
        updateLightboxOptions(window.inventoryList[0].name);
    } else {
        if(sizeContainer) sizeContainer.innerHTML = '';
    }
    
    const lbox = document.getElementById('lightbox');
    if(lbox) lbox.classList.add('active');
    
    const currentUrl = new URL(window.location);
    currentUrl.searchParams.set('product', id);
    window.history.pushState({productId: id}, '', currentUrl.toString());
};

window.closeLightbox = (e) => {
    if (e && e.target !== document.getElementById('lightbox') && !e.target.classList.contains('close-lb')) return;
    
    const lbox = document.getElementById('lightbox');
    if(lbox && lbox.classList.contains('active')) {
        lbox.classList.remove('active');
        const currentUrl = new URL(window.location);
        if(currentUrl.searchParams.has('product')) {
            currentUrl.searchParams.delete('product');
            window.history.replaceState({}, '', currentUrl.toString());
        }
    }
};

window.updateLightboxOptions = (sizeName, btnElem) => {
    const inv = window.inventoryList.find(i => i.name === sizeName);
    if (!inv) return;

    if (btnElem) {
        document.querySelectorAll('.size-pill').forEach(b => b.classList.remove('active'));
        btnElem.classList.add('active');
    }

    const sizeContainer = document.getElementById('lbSizeContainer');
    if(sizeContainer) sizeContainer.dataset.selectedSize = sizeName;

    const priceDisp = document.getElementById('lbPriceDisplay');
    if (priceDisp) {
        let discountHtml = '';
        if (inv.priceBefore && parseFloat(inv.priceBefore) > parseFloat(inv.priceAfter)) {
            discountHtml = `<del style="color:#666; font-size:14px; margin-left:8px;">${inv.priceBefore}</del>`;
        }
        priceDisp.innerHTML = `${discountHtml} ${inv.priceAfter} ${riyal}`;
    }

    const toggles = document.getElementById('lbEffectToggles');
    if (toggles) {
        toggles.innerHTML = '';
        let firstBtn = null;
        if (inv.matte) {
            toggles.innerHTML += `<button class="eff-btn" onclick="setEffect('matte', this)">مطفي</button>`;
            firstBtn = 'matte';
        }
        if (inv.glossy) {
            toggles.innerHTML += `<button class="eff-btn" onclick="setEffect('glossy', this)">لامع</button>`;
            if (!firstBtn) firstBtn = 'glossy';
        }

        const btns = toggles.querySelectorAll('.eff-btn');
        if (btns.length > 0) {
            setEffect(firstBtn, btns[0]);
        }
    }
};

window.setEffect = (type, btn) => {
    document.querySelectorAll('.effect-toggles .eff-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const wrap = document.getElementById('imgWrapper');
    if(wrap) wrap.className = 'img-container ' + (type === 'glossy' ? 'effect-glossy' : 'effect-matte');
};

window.addPreviewToCart = () => {
    const wrap = document.getElementById('imgWrapper');
    const effect = (wrap && wrap.classList.contains('effect-glossy')) ? "لامع" : "مطفي";
    
    const sizeContainer = document.getElementById('lbSizeContainer');
    let selectedSize = sizeContainer ? sizeContainer.dataset.selectedSize : '';
    let inv = window.inventoryList.find(i => i.name === selectedSize) || window.globalInventory;
    let price = inv ? inv.priceAfter : '';

    addToCart(currentImgId, currentImgTitle, currentImgUrl, effect, selectedSize, price);
    window.closeLightbox(); 
};

window.orderPreviewWA = () => { 
    const wrap = document.getElementById('imgWrapper');
    const eff = (wrap && wrap.classList.contains('effect-glossy')) ? "لامع" : "مطفي";
    
    const sizeContainer = document.getElementById('lbSizeContainer');
    let selectedSize = sizeContainer ? sizeContainer.dataset.selectedSize : '';
    let inv = window.inventoryList.find(i => i.name === selectedSize) || window.globalInventory;
    let price = inv ? inv.priceAfter : '';

    sendShortLinkOrder([{ id: currentImgId, title: currentImgTitle, imgUrl: currentImgUrl, effect: eff, sizeName: selectedSize, price }], true); 
};

if(document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initStore);
} else {
    initStore();
}