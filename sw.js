self.addEventListener('install', function(event) {
    self.skipWaiting(); // تفعيل فوري للتحديثات
});

self.addEventListener('activate', function(event) {
    event.waitUntil(clients.claim()); // السيطرة على الصفحة فوراً
});

self.addEventListener('fetch', function(event) {
    // خلك محايد: خل المتصفح يجيب البيانات من النت بشكل طبيعي ولا تتدخل
    event.respondWith(fetch(event.request));
});
