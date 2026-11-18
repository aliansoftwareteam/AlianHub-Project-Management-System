<template>
    <div class="pdf-viewer">
        <div v-if="isLoading" class="process-bar-container">
            <div class="process-bar" :style="{ width: loadProgress + '%' }"></div>
        </div>
      
        <div 
            class="pdf-container" 
            ref="pdfContainer" 
            @mousedown="startDrag"
            @mousemove="onDrag"
            @mouseleave="stopDrag"
            @mouseup="handleTextSelection"
            :class="{ 'is-dragging': isDragging, 'is-draggable': scale > 1 }"
        >
            <div class="pages-wrapper">
                <div 
                    v-for="page in totalPages" 
                    :key="`page-${page}-${pdfResetKey}`"
                    class="page-container"
                    :data-page="page"
                >
                    <canvas 
                        :ref="el => setCanvasRef(el, page)"
                        class="pdf-canvas"
                        :data-page="page"
                    ></canvas>
                    <div 
                        :ref="el => setTextLayerRef(el, page)"
                        class="text-layer"
                        :data-page="page"
                    ></div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { defineProps, defineEmits, ref, watch, onMounted, onUnmounted, nextTick, inject } from "vue";

const props = defineProps({
    source: {
        type: Object,
        required: true
    },
});

const emit = defineEmits(["error", "loadedData", "textSelected"]);

const pdfContainer = ref(null);
const canvasRefs = ref({});
const textLayerRefs = ref({});
const loadProgress = ref(0);
const isLoading = ref(true);
const currentPage = ref(1);
const totalPages = ref(0);
const scale = ref(1);
const pdfResetKey = ref(0);
let pdfDoc = null;
let pdfjsLib = null;
let renderTasks = {};
let pageObservers = {};
let pageDimensions = {};
let renderedPages = new Set();
let textLayerRendered = new Set();
const isProgrammaticScroll = ref(false);
const clientWidth = inject("$clientWidth");

const isDragging = ref(false);
const dragStart = ref({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

// Set canvas refs dynamically
const setCanvasRef = (el, page) => {
    if (el) {
        canvasRefs.value[page] = el;
    }
};

// Set text layer refs dynamically
const setTextLayerRef = (el, page) => {
    if (el) {
        textLayerRefs.value[page] = el;
    }
};

// Drag functions
const startDrag = (e) => {
    if (scale.value <= 1) return;
    if (e.target.closest('.custom-toolbar') || e.target.closest('button')) return;
    
    isDragging.value = true;
    const container = pdfContainer.value;
    
    dragStart.value = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop
    };
    
    e.preventDefault();
};

const onDrag = (e) => {
    if (!isDragging.value) return;
    
    e.preventDefault();
    const container = pdfContainer.value;
    
    const deltaX = e.clientX - dragStart.value.x;
    const deltaY = e.clientY - dragStart.value.y;
    
    container.scrollLeft = dragStart.value.scrollLeft - deltaX;
    container.scrollTop = dragStart.value.scrollTop - deltaY;
};

const stopDrag = () => {
    isDragging.value = false;
};

// Handle text selection
const handleTextSelection = () => {
    isDragging.value = false;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || isDragging.value) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    try {
        const range = selection.getRangeAt(0);
        const rects = range.getClientRects();
        
        if (rects.length === 0) return;

        // Find which page the selection is on
        let pageNumber = null;
        let textLayerElement = range.startContainer;
        
        while (textLayerElement && !textLayerElement.classList?.contains('text-layer')) {
            textLayerElement = textLayerElement.parentElement;
        }
        
        if (textLayerElement) {
            pageNumber = parseInt(textLayerElement.getAttribute('data-page'));
        }

        if (!pageNumber) return;

        // Get bounding box of entire selection
        const boundingRect = range.getBoundingClientRect();
        // const containerRect = pdfContainer.value.getBoundingClientRect();
        const canvas = canvasRefs.value[pageNumber];
        const canvasRect = canvas.getBoundingClientRect();

        // Calculate coordinates relative to the page (canvas)
        const relativeX = boundingRect.left - canvasRect.left;
        const relativeY = boundingRect.top - canvasRect.top;

        // Calculate actual PDF coordinates considering scale
        const pdfX = relativeX / scale.value;
        const pdfY = relativeY / scale.value;
        const pdfWidth = boundingRect.width / scale.value;
        const pdfHeight = boundingRect.height / scale.value;

        // Collect all individual rectangles for multi-line selections
        const allRects = [];
        for (let i = 0; i < rects.length; i++) {
            const rect = rects[i];
            allRects.push({
                x: (rect.left - canvasRect.left) / scale.value,
                y: (rect.top - canvasRect.top) / scale.value,
                width: rect.width / scale.value,
                height: rect.height / scale.value
            });
        }

        const selectionData = {
            text: selectedText,
            pageNumber: pageNumber,
            boundingBox: {
                x: pdfX,
                y: pdfY,
                width: pdfWidth,
                height: pdfHeight
            },
            rectangles: allRects, // Array of all selection rectangles for multi-line
            screenCoordinates: {
                x: boundingRect.left,
                y: boundingRect.top,
                width: boundingRect.width,
                height: boundingRect.height
            }
        };

        emit('textSelected', selectionData);
    } catch (error) {
        console.error('Error handling text selection:', error);
    }
};

// Load PDF.js from CDN
const loadPdfJs = () => {
    return new Promise((resolve, reject) => {
        if (window.pdfjsLib) {
            pdfjsLib = window.pdfjsLib;
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = () => {
            pdfjsLib = window['pdfjs-dist/build/pdf'];
            pdfjsLib.GlobalWorkerOptions.workerSrc = 
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            resolve();
        };
        script.onerror = () => reject(new Error('Failed to load PDF.js'));
        document.head.appendChild(script);
    });
};

// Pre-calculate and set canvas dimensions
const setCanvasDimensions = async (pageNum) => {
    if (!pdfDoc || !canvasRefs.value[pageNum]) return;
    
    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: scale.value });
        
        const canvas = canvasRefs.value[pageNum];
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        pageDimensions[pageNum] = {
            width: viewport.width,
            height: viewport.height
        };
    } catch (error) {
        console.error('Error setting canvas dimensions:', error);
    }
};

// Render text layer for a specific page
const renderTextLayer = async (pageNum) => {
    if (!pdfDoc || !textLayerRefs.value[pageNum] || !canvasRefs.value[pageNum]) return;
    
    if (textLayerRendered.has(`${pageNum}-${scale.value}`)) return;

    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: scale.value });
        const textContent = await page.getTextContent();
        
        const textLayerDiv = textLayerRefs.value[pageNum];
        const canvas = canvasRefs.value[pageNum];
        
        // Clear previous text layer content
        textLayerDiv.innerHTML = '';
        
        // Set text layer dimensions to match canvas
        textLayerDiv.style.width = canvas.width + 'px';
        textLayerDiv.style.height = canvas.height + 'px';

        // **CRITICAL: Set the --scale-factor CSS variable**
        textLayerDiv.style.setProperty('--scale-factor', viewport.scale.toString());

        // Render text layer using PDF.js built-in method
        const textLayer = pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
        });

        await textLayer.promise;
        textLayerRendered.add(`${pageNum}-${scale.value}`);
    } catch (error) {
        console.error('Error rendering text layer:', error);
    }
};

// Render specific page
const renderPage = async (pageNum) => {
    if (!pdfDoc || !canvasRefs.value[pageNum]) return;
    
    if (renderedPages.has(`${pageNum}-${scale.value}`)) return;

    if (renderTasks[pageNum]) {
        try {
            renderTasks[pageNum].cancel();
        } catch (e) {
            // Ignore cancellation errors
        }
        renderTasks[pageNum] = null;
    }

    try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: scale.value });
        
        const canvas = canvasRefs.value[pageNum];
        const context = canvas.getContext('2d');
        
        if (canvas.width !== viewport.width || canvas.height !== viewport.height) {
            canvas.width = viewport.width;
            canvas.height = viewport.height;
        }
        
        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        
        renderTasks[pageNum] = page.render(renderContext);
        await renderTasks[pageNum].promise;
        
        renderTasks[pageNum] = null;
        renderedPages.add(`${pageNum}-${scale.value}`);
        
        // Render text layer after canvas is rendered
        await renderTextLayer(pageNum);
    } catch (error) {
        if (error.name === 'RenderingCancelledException') {
            return;
        }
        console.error('Error rendering page:', error);
        emit('error', error);
    }
};

// Setup IntersectionObserver for lazy loading
const setupObservers = () => {
    if (!pdfContainer.value) return;
    
    Object.values(pageObservers).forEach(observer => observer.disconnect());
    pageObservers = {};
    
    const observerOptions = {
        root: pdfContainer.value,
        rootMargin: '200px',
        threshold: 0.01
    };
    
    const observerCallback = (entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const pageNum = parseInt(entry.target.getAttribute('data-page'));
                renderPage(pageNum);
            }
        });
    };
    
    const observer = new IntersectionObserver(observerCallback, observerOptions);
    
    for (let pageNum = 1; pageNum <= totalPages.value; pageNum++) {
        const canvas = canvasRefs.value[pageNum];
        if (canvas) {
            observer.observe(canvas);
            pageObservers[pageNum] = observer;
        }
    }
};

// Initialize all canvas dimensions without rendering
const initializeCanvasDimensions = async () => {
    if (!pdfDoc) return;
    
    await nextTick();
    
    const dimensionPromises = [];
    for (let pageNum = 1; pageNum <= totalPages.value; pageNum++) {
        dimensionPromises.push(setCanvasDimensions(pageNum));
    }
    
    await Promise.all(dimensionPromises);
    
    await nextTick();
    setupObservers();
};

// Load PDF document
const loadPdf = async () => {
    if (!props.source?.url) return;

    try {
        isLoading.value = true;
        loadProgress.value = 0;
        
        await loadPdfJs();
        
        loadProgress.value = 5;
        
        const loadingTask = pdfjsLib.getDocument(props.source.url);
        
        loadingTask.onProgress = function(progressData) {
            if (progressData.total > 0) {
                const downloadProgress = (progressData.loaded / progressData.total) * 75;
                loadProgress.value = Math.min(5 + downloadProgress, 80);
            } else {
                if (loadProgress.value < 70) {
                    loadProgress.value += 2;
                }
            }
        };
        
        pdfDoc = await loadingTask.promise;
        
        loadProgress.value = 85;
        
        totalPages.value = pdfDoc.numPages;
        
        loadProgress.value = 90;
        await initializeCanvasDimensions();
        
        loadProgress.value = 100;
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
        isLoading.value = false;
        loadProgress.value = 0;
        emit("loadedData");
        
        await nextTick();
        if (pdfContainer.value) {
            pdfContainer.value.scrollTop = 0;
            pdfContainer.value.scrollLeft = 0;
        }
    } catch (error) {
        console.error('Error loading PDF:', error);
        isLoading.value = false;
        loadProgress.value = 0;
        emit('error', error);
    }
};

// Handle scroll to update current page
const handleScroll = () => {
    if (!pdfContainer.value || isDragging.value || isProgrammaticScroll.value) return;
    
    const container = pdfContainer.value;
    const scrollTop = container.scrollTop;
    
    for (let pageNum = 1; pageNum <= totalPages.value; pageNum++) {
        const canvas = canvasRefs.value[pageNum];
        if (!canvas) continue;
        
        const canvasTop = canvas.offsetTop;
        const canvasBottom = canvasTop + canvas.height;
        
        if (scrollTop >= canvasTop - 100 && scrollTop < canvasBottom - 100) {
            currentPage.value = pageNum;
            break;
        }
    }
};

// Re-render all visible pages on zoom
const updateZoom = async () => {
    if (!pdfContainer.value) return;
    
    const savedCurrentPage = currentPage.value;
    const container = pdfContainer.value;
    
    let relativeScrollPosition = 0;
    if (canvasRefs.value[savedCurrentPage]) {
        const canvas = canvasRefs.value[savedCurrentPage];
        const pageTop = canvas.offsetTop;
        const scrollTop = container.scrollTop;
        relativeScrollPosition = (scrollTop - pageTop) / canvas.height;
    }
    
    renderedPages.clear();
    textLayerRendered.clear();
    
    await initializeCanvasDimensions();
    
    await nextTick();
    if (canvasRefs.value[savedCurrentPage]) {
        const canvas = canvasRefs.value[savedCurrentPage];
        const newScrollTop = canvas.offsetTop + (canvas.height * relativeScrollPosition);
        container.scrollTop = newScrollTop;
    }
};

// Zoom functions with debounce
let zoomTimeout = null;
const zoomIn = () => {
    if (scale.value < 3) {
        scale.value += 0.25;
        
        clearTimeout(zoomTimeout);
        zoomTimeout = setTimeout(() => {
            updateZoom();
        }, 300);
    }
};

const zoomOut = () => {
    if (scale.value > 0.5) {
        scale.value -= 0.25;
        
        clearTimeout(zoomTimeout);
        zoomTimeout = setTimeout(() => {
            updateZoom();
        }, 300);
    }
};

watch(() => clientWidth.value, async (newClientWidth) => {
    if(newClientWidth <= 650){
        scale.value = 0.5;
        clearTimeout(zoomTimeout);
        zoomTimeout = setTimeout(() => {
            updateZoom();
        }, 300);
    } else{
        scale.value = 1;
        clearTimeout(zoomTimeout);
        zoomTimeout = setTimeout(() => {
            updateZoom();
        }, 300);
    }
});

watch(() => props.source?.url, async (newUrl) => {
    if (newUrl) {
        Object.values(renderTasks).forEach(task => {
            if (task) {
                try {
                    task.cancel();
                } catch (e) {
                    // Ignore
                }
            }
        });
        renderTasks = {};
        
        Object.values(pageObservers).forEach(observer => observer.disconnect());
        pageObservers = {};
        
        currentPage.value = 1;
        scale.value = 1;
        canvasRefs.value = {};
        textLayerRefs.value = {};
        pageDimensions = {};
        renderedPages.clear();
        textLayerRendered.clear();
        loadProgress.value = 0;
        pdfResetKey.value++;
        
        await nextTick();
        if (pdfContainer.value) {
            pdfContainer.value.scrollTop = 0;
            pdfContainer.value.scrollLeft = 0;
        }
        
        loadPdf();
    }
});

onMounted(() => {
    loadPdf();
    
    if (pdfContainer.value) {
        pdfContainer.value.addEventListener('scroll', handleScroll);
    }
});

onUnmounted(() => {
    Object.values(renderTasks).forEach(task => {
        if (task) {
            try {
                task.cancel();
            } catch (e) {
                // Ignore
            }
        }
    });
    
    Object.values(pageObservers).forEach(observer => observer.disconnect());
    
    if (pdfContainer.value) {
        pdfContainer.value.removeEventListener('scroll', handleScroll);
    }
    
    clearTimeout(zoomTimeout);
});

defineExpose({
    currentPage,
    totalPages,
    scale,
    isLoading,
    zoomIn,
    zoomOut
});
</script>


<style scoped>
.pdf-viewer {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
}

.process-bar-container {
    height: 4px;
    background: var(--rail-active);
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    z-index: 10;
    overflow: hidden;
}

.process-bar {
    height: 4px;
    background: linear-gradient(90deg, var(--rail-ink-strong), var(--rail-ok));
    position: absolute;
    top: 0;
    left: 0;
    z-index: 10;
    transition: width 0.3s ease-out;
}

.custom-toolbar {
    display: flex;
    align-items: center;
    padding: 8px 0px;
    color: var(--rail-ink-strong);
    flex-shrink: 0;
    transform: translateX(-50%);
    left: 50%;
    position: fixed;
    top: 30px;
    z-index: 2;
    align-items: center;
    justify-content: center;
    width: 100%;
}

.nav-btn {
    padding: 8px 16px;
    background: var(--rail-hover);
    color: var(--rail-ink-strong);
    border: 1px solid var(--rail-active);
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: background-color 0.2s ease;
}

.nav-btn:hover:not(:disabled) {
    background: var(--rail-active);
}

.nav-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.page-info, .zoom-info {
    color: var(--rail-ink);
    font-size: 14px;
}

.page-info {
    text-align: center;
    padding-right: 5px;
}

.zoom-info {
    text-align: center;
    padding: 0px 15px;
}

.zoom-btn {
    cursor: pointer;
    border-radius: 0;
    border: 0;
    padding: 0px;
    background: color-mix(in srgb, var(--rail) 32%, transparent);
    color: var(--rail-ink-strong);
    font-size: 1.4rem;
}

.divider {
    width: 1px;
    height: 24px;
    background: var(--rail-active);
    margin: 0 8px;
}

.pdf-container {
    flex: 1;
    overflow: auto;
    transition: cursor 0.2s;
}

.pdf-container.is-draggable {
    cursor: grab;
}

.pdf-container.is-dragging {
    cursor: grabbing;
    user-select: none;
}

.pdf-container.is-dragging .pdf-canvas {
    pointer-events: none;
}

.pdf-container.is-dragging .text-layer {
    pointer-events: none;
    user-select: none;
}

.pages-wrapper {
    display: flex;
    flex-direction: column;
    padding: 8px;
    gap: 10px;
    min-width: 100%;
}

.page-container {
    position: relative;
    display: block;
    margin: 0 auto;
}

.pdf-canvas {
    box-shadow: 0 2px 10px color-mix(in srgb, var(--rail) 50%, transparent);
    background: white;
    display: block;
    margin: 0 auto;
}

/* Text Layer Styles - Critical for text selection */
.text-layer {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    overflow: hidden;
    opacity: 0.5;
    line-height: 1.0;
    user-select: text;
    cursor: text;
}

.text-layer :deep(span) {
    color: transparent;
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
}

.text-layer :deep(::selection) {
    background: var(--brand-border);
}

/* Mobile Responsive */
@media (max-width: 768px) {
    .nav-btn {
        padding: 6px 10px;
        font-size: 12px;
    }
    
    .page-info {
        font-size: 12px;
    }
    
    .zoom-btn {
        width: 30px;
        font-size: 16px;
    }
    
    .zoom-info {
        font-size: 12px;
    }
    
    .pages-wrapper {
        padding: 10px;
        gap: 8px;
    }
}
</style>
