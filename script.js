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

window.addEventListener('scroll', () => {
    const header = document.getElementById('floatingHeader');
    if(header) {
        if (window.scrollY > 60) header.classList.add('scrolled');
        else header.classList.remove('scrolled');
    }
});

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
        
        if (diff > 120) {
            window.history.back();
        } else {
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

    if (!product && document.getElementById('lightbox') && document.getElementById('lightbox').classList.contains('active')) {
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
        currentSubCat = 'الكل';
        updateSubCatUI();
        applyFilters();
    } else if (!product) {
        if(document.getElementById('productsView')) document.getElementById('productsView').style.display = 'none';
        if(document.getElementById('home-section')) document.getElementById('home-section').style.display = 'block';
    }
});

function updateMetaTags(title, desc, img) {
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", desc);
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", desc);
    if (img) document.querySelector('meta[property="og:image"]')?.setAttribute("content", img);
}

function updateSchemaMarkup(product) {
    let script = document.getElementById('seo-schema');
    if (!script) {
        script = document.createElement('script');
        script.type = 'application/ld+json';
        script.id = 'seo-schema';
        document.head.appendChild(script);
    }
    if (product) {
        const schema = {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": product.title_ar || "لوحة معدنية جدارية",
            "image": [product.imageUrl],
            "description": `لوحة معدنية جدارية فاخرة بتصميم ${product.title_ar} من بوسترتيك.`,
            "brand": { "@type": "Brand", "name": "Postertic" }
        };
        script.textContent = JSON.stringify(schema);
    } else { script.textContent = ''; }
}

async function initStore() {
    try {
        const catSnap = await db.collection("categories").get();
        let catsArr = [];
        catSnap.forEach(doc => { catsArr.push({ id: doc.id, ...doc.data() }); });
        catsArr.sort((a, b) => (a.order || 0) - (b.order || 0));

        let homeHtml = '';
        catsArr.forEach(c => {
            categoriesData[c.id] = c;
            homeHtml += `
                <div class="cat-card" onclick="openCategory('${c.id}')">
                    <img src="${c.imageUrl}" loading="lazy">
                    <div class="cat-overlay"><h2 style="font-size: 1.2rem">${c.id}</h2></div>
                </div>`;
        });
        if(document.getElementById('homeGrid')) document.getElementById('homeGrid').innerHTML = homeHtml;
        if(document.getElementById('loader')) document.getElementById('loader').style.display = 'none';

        const invSnap = await db.collection("inventory").orderBy("timestamp", "desc").get();
        window.inventoryList = [];
        invSnap.forEach(doc => {
            window.inventoryList.push({ id: doc.id, ...doc.data() });
        });
        
        if (window.inventoryList.length > 0) {
            window.globalInventory = window.inventoryList[0];
        }

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

        db.collection("products").get().then(prodSnap => {
            allProducts = prodSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            allProducts.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
            
            if (sharedProduct) {
                const prod = allProducts.find(p => p.id === sharedProduct);
                if(prod) {
                    if(prod.mainCategory) openCategory(prod.mainCategory); 
                    openLightbox(prod.id, prod.imageUrl, (prod.title_ar || "").replace(/'/g, "\\'"));
                }
            } else if (!shortCartId && sharedCat && categoriesData[sharedCat]) { 
                openCategory(sharedCat); 
            } else if (!shortCartId) { 
                if(document.getElementById('home-section')) document.getElementById('home-section').style.display = 'block'; 
                updateMetaTags('بوسترتيك | فن يلامس ذوقك', 'اكتشف تشكيلة بوسترتيك الفاخرة.', null);
            }
        });

        updateCartUI();

    } catch (error) { 
        if(document.getElementById('loader')) document.getElementById('loader').innerHTML = '<p style="color:red; text-align:center;">حدث خطأ في جلب البيانات.</p>'; 
    }
}

window.goHome = () => {
    document.getElementById('productsView').style.display = 'none';
    document.getElementById('home-section').style.display = 'block';
    document.getElementById('searchInput').value = '';
    
    window.history.pushState({}, '', window.location.pathname);
    updateMetaTags('بوسترتيك | فن يلامس ذوقك', 'اكتشف تشكيلة بوسترتيك الفاخرة.', null);
    updateSchemaMarkup(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

function updateSubCatUI() {
    const nav = document.getElementById('catsNav');
    const dropdown = document.getElementById('subCatsDropdown');
    
    if (!categoriesData[currentMainCat] || !categoriesData[currentMainCat].subs || categoriesData[currentMainCat].subs.length === 0) {
        nav.innerHTML = ''; dropdown.innerHTML = ''; dropdown.classList.remove('show'); return;
    }

    const allSubs = categoriesData[currentMainCat].subs;
    let maxVisible = window.innerWidth < 450 ? 1 : (window.innerWidth < 768 ? 2 : 4);
    let visibleSubs = [];
    if (currentSubCat !== 'الكل' && allSubs.includes(currentSubCat)) {
        visibleSubs.push(currentSubCat);
    }
    
    for (let s of allSubs) {
        if (visibleSubs.length >= maxVisible) break; 
        if (!visibleSubs.includes(s)) visibleSubs.push(s);
    }
    
    let navHtml = `<button class="sub-btn ${currentSubCat === 'الكل' ? 'active' : ''}" onclick="filterBySub('الكل')">الكل</button>`;
    visibleSubs.forEach(s => {
        navHtml += `<button class="sub-btn ${currentSubCat === s ? 'active' : ''}" onclick="filterBySub('${s}')">${s}</button>`;
    });

    if (allSubs.length > visibleSubs.length) {
        navHtml += `<button class="sub-btn sub-btn-more" id="moreSubsBtn" onclick="toggleDropdown(event)">المزيد ▼</button>`;
    }
    nav.innerHTML = navHtml;

    let dropHtml = `<button class="dropdown-item ${currentSubCat === 'الكل' ? 'active' : ''}" onclick="filterBySub('الكل', true)">الكل <i class="sicon-check" style="opacity:${currentSubCat === 'الكل' ? '1' : '0'}"></i></button>`;
    allSubs.forEach(s => {
        const isActive = currentSubCat === s;
        dropHtml += `<button class="dropdown-item ${isActive ? 'active' : ''}" onclick="filterBySub('${s}', true)">${s} <i class="sicon-check" style="opacity:${isActive ? '1' : '0'}"></i></button>`;
    });
    dropdown.innerHTML = dropHtml;
}

window.addEventListener('resize', () => { 
    const pv = document.getElementById('productsView');
    if(pv && pv.style.display === 'block') updateSubCatUI(); 
});

window.toggleDropdown = (e) => {
    e.stopPropagation();
    const d = document.getElementById('subCatsDropdown');
    if(d) d.classList.toggle('show');
};

window.addEventListener('click', (e) => {
    const dropdown = document.getElementById('subCatsDropdown');
    if(dropdown && dropdown.classList.contains('show') && !e.target.closest('#moreSubsBtn')) {
        dropdown.classList.remove('show');
    }
    
    if(!e.target.closest('.cart-size-btn')) {
        document.querySelectorAll('[id^="cartSizeDrop_"]').forEach(el => el.classList.remove('show'));
    }

    const popup = document.getElementById('sizePopup');
    if(popup) popup.style.display = 'none';
});

window.addEventListener('scroll', () => { 
    const popup = document.getElementById('sizePopup');
    if(popup) popup.style.display = 'none'; 
}, true);

window.openCategory = (mainCat) => {
    currentMainCat = mainCat;
    document.getElementById('home-section').style.display = 'none';
    document.getElementById('productsView').style.display = 'block';
    document.getElementById('catTitle').innerText = mainCat;
    document.getElementById('searchInput').value = '';

    window.history.pushState({}, '', '?cat=' + encodeURIComponent(mainCat));
    updateMetaTags(`قسم ${mainCat} | بوسترتيك`, `تصفح تشكيلة ${mainCat}.`, categoriesData[mainCat]?.imageUrl);
    updateSchemaMarkup(null);

    currentSubCat = 'الكل'; 
    updateSubCatUI();
    applyFilters();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.filterBySub = (subCat, fromDropdown = false) => {
    currentSubCat = subCat;
    updateSubCatUI(); 
    if (fromDropdown) document.getElementById('subCatsDropdown').classList.remove('show');
    applyFilters();
};

window.handleSearch = () => {
    if (document.getElementById('home-section').style.display === 'block') {
        currentMainCat = 'الكل'; currentSubCat = 'الكل';
        document.getElementById('home-section').style.display = 'none';
        document.getElementById('productsView').style.display = 'block';
        document.getElementById('catTitle').innerText = "نتائج البحث";
        document.getElementById('catsNav').innerHTML = ''; 
    }
    applyFilters();
};

function applyFilters() {
    const searchInput = document.getElementById('searchInput');
    if(!searchInput) return;
    const term = searchInput.value.toLowerCase().trim();
    const filtered = allProducts.filter(p => {
        const inTitle = (p.title_ar || p.seoTitle || "").toLowerCase().includes(term);
        const matchMain = currentMainCat === 'الكل' || p.mainCategory === currentMainCat;
        const matchSub = currentSubCat === 'الكل' || p.subCategory === currentSubCat;
        return inTitle && matchMain && matchSub;
    });
    renderProducts(filtered);
}

function renderProducts(products) {
    const gallery = document.getElementById('galleryGrid');
    if (!gallery) return;
    if (products.length === 0) { gallery.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #888; padding: 50px;">لا توجد لوحات تطابق بحثك</div>'; return; }

    let html = '';
    products.forEach(p => {
        const title = p.title_ar || p.seoTitle || "لوحة بوسترتيك";
        const cleanTitleStr = title.replace(/'/g, "\\'");
        const inv = window.globalInventory;
        
        let priceHtml = '';
        let sizeHtml = '';
        let defaultEffect = 'مطفي';
        let subTitle = title.replace(/لوحة بوسترتي?ك المعدنية/g, "").trim();

        if (inv) {
            let discountBadge = '';
            if (inv.priceBefore && parseFloat(inv.priceBefore) > parseFloat(inv.priceAfter)) {
                let discountPercent = Math.round(((inv.priceBefore - inv.priceAfter) / inv.priceBefore) * 100);
                discountBadge = `<span style="background: rgba(239, 68, 68, 0.1); color: var(--danger); padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: bold; border: 1px solid rgba(239, 68, 68, 0.2);">خصم ${discountPercent}%</span>`;
            }

            priceHtml = `
                <div class="price-row" style="justify-content: center; gap: 8px; margin-bottom: 10px;">
                    <span style="font-size: 13px; color: #888;">السعر:</span>
                    <span class="price-after">${inv.priceAfter} <img src="https://www.sama.gov.sa/ar-sa/Currency/Documents/Saudi_Riyal_Symbol-2.svg" class="riyal-icon" alt="ر.س"></span>
                    ${inv.priceBefore ? `<span class="price-before">${inv.priceBefore} <img src="https://www.sama.gov.sa/ar-sa/Currency/Documents/Saudi_Riyal_Symbol-2.svg" class="riyal-icon" alt="ر.س"></span>` : ''}
                    ${discountBadge}
                </div>`;
            
            let sizesArr = window.inventoryList.map(i => i.name);
            if (sizesArr.length > 0) {
                sizeHtml = `
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; width:100%;">
                        <span style="font-size: 13px; color: #888; white-space: nowrap;">المقاس:</span>
                        <select id="size_${p.id}" class="size-select" style="margin-bottom:0; flex:1;">
                            ${sizesArr.map(s => `<option value="${s}">${s}</option>`).join('')}
                        </select>
                    </div>`;
            }

            if (inv.glossy && !inv.matte) defaultEffect = 'لامع';
        }

        html += `
            <div class="product-card">
                <div class="card-image" onclick="openLightbox('${p.id}', '${p.imageUrl}', '${cleanTitleStr}')">
                    <img src="${p.imageUrl}" loading="lazy">
                </div>
                <div class="card-body" style="padding: 15px;">
                    <h3 class="card-title" onclick="openLightbox('${p.id}', '${p.imageUrl}', '${cleanTitleStr}')" style="line-height: 1.5; margin-bottom: 12px; max-height: none;">
                        <span style="display: block; font-size: 13px;">لوحة بوسترتيك المعدنية</span>
                        <span style="display: block; font-size: 12px; color: var(--primary-color); margin-top: 4px;">${subTitle}</span>
                    </h3>
                    ${priceHtml}
                    ${sizeHtml}
                    <div class="card-actions-row">
                        <button onclick="addToCartFromCard('${p.id}', '${cleanTitleStr}', '${p.imageUrl}', '${defaultEffect}')" class="cart-btn" style="flex:2;">
                            <i class="sicon-shopping"></i> إضافة للسلة
                        </button>
                        <button onclick="orderSingleWAFromCard('${p.id}', '${cleanTitleStr}', '${p.imageUrl}')" class="cart-btn wa-btn" style="flex:1;">
                            <i class="sicon-whatsapp2"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    gallery.innerHTML = html;
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

window.addToCartFromCard = (id, title, imgUrl, effect) => {
    let sizeSelect = document.getElementById(`size_${id}`);
    let selectedSize = sizeSelect ? sizeSelect.value : '';
    let inv = window.inventoryList.find(i => i.name === selectedSize) || window.globalInventory;
    let price = inv ? inv.priceAfter : '';

    addToCart(id, title, imgUrl, effect, selectedSize, price);
};

window.removeFromCart = (index) => { cart.splice(index, 1); localStorage.setItem('postertic_cart', JSON.stringify(cart)); updateCartUI(); };
window.updateItemEffect = (index, newEffect) => { cart[index].effect = newEffect; localStorage.setItem('postertic_cart', JSON.stringify(cart)); updateCartUI(); };

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
            priceBeforeHtml = `<span class="price-before" style="font-size:11px;">${currentInv.priceBefore} <img src="https://www.sama.gov.sa/ar-sa/Currency/Documents/Saudi_Riyal_Symbol-2.svg" class="riyal-icon" alt="ر.س"></span>`;
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
                    <span class="price-after" style="font-size:14px; font-weight:bold;">${item.price} <img src="https://www.sama.gov.sa/ar-sa/Currency/Documents/Saudi_Riyal_Symbol-2.svg" class="riyal-icon" alt="ر.س"></span>
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
            message = `أهلاً بوسترتيك 👋\nحاب استفسر عن:\nالاسم: ${itemsArray[0].title}\nالنوع: ${itemsArray[0].effect}\n${itemsArray[0].sizeName ? 'المقاس: '+itemsArray[0].sizeName+'\n' : ''}${itemsArray[0].price ? 'السعر: '+itemsArray[0].price+' ريال\n' : ''}🔗 ${shareableUrl}`;
        } else {
            message = `أهلاً بوسترتيك 👋\nحاب أعتمد طلبي:\n🔗 ${shareableUrl}`;
        }

        window.open(`https://wa.me/966575050509?text=${encodeURIComponent(message)}`, '_blank');
    } catch (error) { console.error(error); }

    if (btn) { btn.innerHTML = `<i class="sicon-whatsapp2" style="font-size: 22px;"></i> إرسال الطلب عبر واتساب`; btn.disabled = false; }
};

window.checkoutWhatsApp = () => { if(cart.length > 0) sendShortLinkOrder(cart, false); };

window.orderSingleWAFromCard = (id, title, url) => { 
    let sizeSelect = document.getElementById(`size_${id}`);
    let selectedSize = sizeSelect ? sizeSelect.value : '';
    let inv = window.inventoryList.find(i => i.name === selectedSize) || window.globalInventory;
    let price = inv ? inv.priceAfter : '';
    let effect = (inv && inv.matte) ? 'مطفي' : 'لامع';

    sendShortLinkOrder([{ id, title, imgUrl: url, effect: effect, sizeName: selectedSize, price }], true); 
};

window.checkoutToStore = () => {
    if (cart.length === 0) return;
    let copyText = "طلباتي:\n\n";
    cart.forEach((item, i) => { 
        copyText += `(${i + 1}) اللوحة: ${item.title}\nاللمسة: ${item.effect}\n`;
        if (item.sizeName) copyText += `المقاس: ${item.sizeName}\n`;
        if (item.price) copyText += `السعر: ${item.price} ريال\n`;
        copyText += `---\n`; 
    });
    navigator.clipboard.writeText(copyText).then(() => {
        showToast("تم النسخ! الصقها في المتجر 🔗");
        setTimeout(() => { window.location.href = "https://postertic.com/GYpBZXa"; }, 3000);
    });
};

function showToast(msg) {
    const toast = document.getElementById('toast');
    if(!toast) return;
    toast.innerText = msg; toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

// --- نافذة عرض اللوحة الديناميكية (الجديدة) ---
window.openLightbox = (id, url, title) => {
    currentImgId = id; currentImgUrl = url; currentImgTitle = title;
    const pImg = document.getElementById('preview-img');
    if(pImg) pImg.src = url;
    
    // حقن قائمة المقاسات برمجياً
    const sizeContainer = document.getElementById('lbSizeContainer');
    if (sizeContainer && window.inventoryList && window.inventoryList.length > 0) {
        let options = window.inventoryList.map(inv => `<option value="${inv.name}">${inv.name}</option>`).join('');
        sizeContainer.innerHTML = `
            <select id="lbSizeSelect" class="size-select" style="margin-bottom:0;" onchange="updateLightboxOptions(this.value)">
                ${options}
            </select>
        `;
        // تشغيل الدالة لتحديث السعر والخيارات بناءً على أول مقاس افتراضي
        updateLightboxOptions(window.inventoryList[0].name);
    } else {
        if(sizeContainer) sizeContainer.innerHTML = '';
    }
    
    const lbox = document.getElementById('lightbox');
    if(lbox) lbox.classList.add('active');
    
    window.history.pushState({productId: id}, '', '?product=' + id);
    updateMetaTags(`شراء ${title} | بوسترتيك`, `أضف لمسة فنية مع لوحة ${title}.`, url);
    updateSchemaMarkup({id: id, imageUrl: url, title_ar: title});
};

window.updateLightboxOptions = (sizeName) => {
    const inv = window.inventoryList.find(i => i.name === sizeName);
    if (!inv) return;

    // 1. تحديث السعر مع أيقونة الريال
    const priceDisp = document.getElementById('lbPriceDisplay');
    if (priceDisp) {
        let discountHtml = '';
        if (inv.priceBefore && parseFloat(inv.priceBefore) > parseFloat(inv.priceAfter)) {
            discountHtml = `<del style="color:#666; font-size:12px; margin-right:8px;">${inv.priceBefore}</del>`;
        }
        priceDisp.innerHTML = `السعر: ${discountHtml} ${inv.priceAfter} <img src="https://www.sama.gov.sa/ar-sa/Currency/Documents/Saudi_Riyal_Symbol-2.svg" class="riyal-icon" alt="ر.س" style="height: 1.1em; vertical-align: text-bottom; filter: brightness(0) invert(73%) sepia(19%) saturate(1008%) hue-rotate(345deg) brightness(91%) contrast(89%);">`;
    }

    // 2. تحديث أزرار (مطفي/لامع)
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

window.closeLightbox = (e) => {
    if (e && e.target !== document.getElementById('lightbox') && !e.target.classList.contains('close-lb')) return;
    window.history.back();
};

window.setEffect = (type, btn) => {
    document.querySelectorAll('#lbEffectToggles .eff-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const wrap = document.getElementById('imgWrapper');
    if(wrap) wrap.className = 'img-container ' + (type === 'glossy' ? 'effect-glossy' : 'effect-matte');
};

window.addPreviewToCart = () => {
    const wrap = document.getElementById('imgWrapper');
    const effect = (wrap && wrap.classList.contains('effect-glossy')) ? "لامع" : "مطفي";
    
    const sizeSelect = document.getElementById('lbSizeSelect');
    let selectedSize = sizeSelect ? sizeSelect.value : '';
    let inv = window.inventoryList.find(i => i.name === selectedSize) || window.globalInventory;
    let price = inv ? inv.priceAfter : '';

    addToCart(currentImgId, currentImgTitle, currentImgUrl, effect, selectedSize, price);
    window.history.back(); 
};

window.orderPreviewWA = () => { 
    const wrap = document.getElementById('imgWrapper');
    const eff = (wrap && wrap.classList.contains('effect-glossy')) ? "لامع" : "مطفي";
    
    const sizeSelect = document.getElementById('lbSizeSelect');
    let selectedSize = sizeSelect ? sizeSelect.value : '';
    let inv = window.inventoryList.find(i => i.name === selectedSize) || window.globalInventory;
    let price = inv ? inv.priceAfter : '';

    sendShortLinkOrder([{ id: currentImgId, title: currentImgTitle, imgUrl: currentImgUrl, effect: eff, sizeName: selectedSize, price }], true); 
};

// تشغيل النظام
if(document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initStore);
} else {
    initStore();
}
