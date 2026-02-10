'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload,
  Download,
  Loader2,
  CheckCircle2,
  Layers,
  Cpu,
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import JSZip from 'jszip';

import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

// Use the ESM worker bundled via your build tool (avoids relying on unpkg and mixed-content issues)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

/**
 * 常數定義 (對應 src/utils/constant)
 */
const TILE_SIZE = 256;
const AUTO_BASE_SCALE = 2.0;

/**
 * 功能函式 (對應 src/utils/help)
 */
const calculateMaxLevel = (width, height) => {
  return Math.ceil(Math.log2(Math.max(width, height)));
};

/**
 * 自定義 Hook (對應核心邏輯規範 - 解耦邏輯)
 */
const usePdfProcessor = () => {
  const [pdfInstance, setPdfInstance] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState({ message: '', type: 'info' });
  const [previews, setPreviews] = useState([]);

  const loadPdf = async (file) => {
    setStatus({ message: '正在讀取 PDF...', type: 'info' });
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
      reader.onload = async (event) => {
        const typedarray = new Uint8Array(event.target.result);
        try {
          const loadingTask = pdfjs.getDocument(typedarray);
          const pdf = await loadingTask.promise;
          setPdfInstance(pdf);
          setStatus({
            message: `PDF 加載成功：共 ${pdf.numPages} 頁`,
            type: 'success',
          });
          resolve(pdf);
        } catch (err) {
          setStatus({ message: '無法讀取 PDF', type: 'error' });
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const generateTiles = async (pdf, fileName) => {
    if (!pdf || !window) return;

    const zip = new JSZip();

    setIsProcessing(true);
    setPreviews([]);
    setProgress(0);

    try {
      const page = await pdf.getPage(1);
      const viewportMax = page.getViewport({ scale: AUTO_BASE_SCALE });
      const fullWidth = Math.round(viewportMax.width);
      const fullHeight = Math.round(viewportMax.height);
      const maxLevel = calculateMaxLevel(fullWidth, fullHeight);
      const cache = await caches.open('tiles');

      // 設定檔
      const osdConfig = {
        tileSources: {
          width: fullWidth,
          height: fullHeight,
          tileSize: TILE_SIZE,
          tileOverlap: 0,
          maxLevel: maxLevel,
          getTileUrl: '(level, x, y) => `/tiles/${level}/${x}_${y}.png`',
        },
      };
      const osdConfigPath = `/tiles/osd_config.json`;
      const req = new Request(osdConfigPath, { method: 'GET' });

      const res = new Response(JSON.stringify(osdConfig), {
        headers: {
          'Content-Type': 'application/json',
          // 你可以加 cache-control 但對 Cache Storage 本身沒差，主要是語意
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });

      await cache.put(req, res);

      for (let level = 0; level <= maxLevel; level++) {
        setStatus({
          message: `正在優化層級: Level ${level} / ${maxLevel}...`,
          type: 'info',
        });

        const levelReduction = Math.pow(2, maxLevel - level);
        const levelWidth = Math.ceil(fullWidth / levelReduction);
        const levelHeight = Math.ceil(fullHeight / levelReduction);

        const levelScale = AUTO_BASE_SCALE / levelReduction;
        const viewport = page.getViewport({ scale: levelScale });

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { alpha: false });
        canvas.width = levelWidth;
        canvas.height = levelHeight;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport }).promise;

        const cols = Math.ceil(canvas.width / TILE_SIZE);
        const rows = Math.ceil(canvas.height / TILE_SIZE);
        // const levelFolder = tilesFolder.folder(level.toString());

        const levelPreviews = [];

        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const tileCanvas = document.createElement('canvas');
            tileCanvas.width = TILE_SIZE;
            tileCanvas.height = TILE_SIZE;
            const tctx = tileCanvas.getContext('2d');
            tctx.fillStyle = '#ffffff';
            tctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

            const sx = x * TILE_SIZE;
            const sy = y * TILE_SIZE;
            const sw = Math.min(TILE_SIZE, canvas.width - sx);
            const sh = Math.min(TILE_SIZE, canvas.height - sy);

            if (sw > 0 && sh > 0) {
              tctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
            }

            const blob = await new Promise((r) =>
              tileCanvas.toBlob(r, 'image/png')
            );
            const tilePath = `/tiles/${level}/${x}_${y}.png`;
            const req = new Request(tilePath, { method: 'GET' });

            const res = new Response(blob, {
              headers: {
                'Content-Type': 'image/png',
                // 你可以加 cache-control 但對 Cache Storage 本身沒差，主要是語意
                'Cache-Control': 'public, max-age=31536000, immutable',
              },
            });

            await cache.put(req, res);
            // levelFolder.file(`${x}_${y}.png`, blob);

            // if (level === maxLevel && levelPreviews.length < 8) {
            //   levelPreviews.push({
            //     url: tileCanvas.toDataURL('image/png'),
            //     label: `L${level}: ${x}_${y}`,
            //   });
            // }
          }
        }

        if (level === maxLevel) setPreviews(levelPreviews);
        setProgress(Math.round((level / maxLevel) * 100));
      }

      setStatus({ message: '打包文件中...', type: 'info' });
      // const content = await zip.generateAsync({ type: 'blob' });
      // const link = document.createElement('a');
      // link.href = URL.createObjectURL(content);
      // link.download = `osd_pyramid_${fileName.replace('.pdf', '')}.zip`;
      // link.click();

      //改要存在 service-worker-storage 儲存

      setStatus({ message: '轉換完成！', type: 'success' });
    } catch (err) {
      console.error(err);
      setStatus({ message: '轉換過程發生錯誤', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    pdfInstance,
    isProcessing,
    progress,
    status,
    previews,
    loadPdf,
    generateTiles,
  };
};

export default function PdfViewer() {
  const [pdfFile, setPdfFile] = useState(null);
  const fileInputRef = useRef(null);

  const {
    pdfInstance,
    isProcessing,
    progress,
    status,
    previews,
    loadPdf,
    generateTiles,
  } = usePdfProcessor();

  // 初始化腳本載入
  // useEffect(() => {
  //   const loadExternalScripts = async () => {
  //     const scripts = [
  //       'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  //       'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  //     ];

  //     for (const src of scripts) {
  //       if (!document.querySelector(`script[src="${src}"]`)) {
  //         const script = document.createElement('script');
  //         script.src = src;
  //         script.async = false;
  //         document.head.appendChild(script);
  //         await new Promise((res) => (script.onload = res));
  //       }
  //     }

  //     if (window.pdfjsLib) {
  //       window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
  //     }
  //   };
  //   loadExternalScripts();
  // }, []);

  /**
   * 事件處理器命名規範：handle[EventName]
   */
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);

      await caches.delete(`tiles`);
      await loadPdf(file);
    }
  };

  const handleProcessTiles = () => {
    if (pdfInstance && pdfFile) {
      generateTiles(pdfInstance, pdfFile.name);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.error('SW register failed', err));
  }, []);

  // useEffect(() => {
  //   return () => {
  //     caches.delete(`tiles`);
  //   };
  // }, []);

  if (!pdfjs) return '載入中...';

  return (
    <div className="h-full bg-slate-50 p-4 md:p-8 font-sans text-slate-900 mt-14">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold flex items-center justify-center gap-2">
            <Layers className="text-blue-600" /> OSD 規格化產生器
          </h1>
          <p className="text-slate-500 mt-2">
            符合專案規範重構版本 (2^N 自動計算)
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左側操作區 */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl border shadow-sm">
              <h2 className="font-bold mb-4 flex items-center gap-2 text-slate-700">
                1. 檔案上傳
              </h2>
              <div
                onClick={handleUploadClick}
                className={`border-2 border-dashed p-10 text-center cursor-pointer rounded-lg transition-all ${
                  pdfFile
                    ? 'bg-green-50 border-green-300'
                    : 'hover:bg-blue-50 border-slate-200'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="application/pdf"
                  className="hidden"
                />
                {pdfFile ? (
                  <div className="flex flex-col items-center">
                    <CheckCircle2 className="w-10 h-10 text-green-500 mb-2" />
                    <span className="text-green-700 font-medium truncate w-full px-4">
                      {pdfFile.name}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-slate-400">
                    <Upload className="w-10 h-10 mb-2 opacity-50" />
                    <span className="text-sm">選擇 PDF 檔案</span>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl border shadow-sm border-l-4 border-l-blue-500">
              <h2 className="font-bold mb-4 flex items-center gap-2 text-slate-700">
                <Cpu className="w-5 h-5 text-blue-500" /> 自動核心邏輯
              </h2>
              <div className="space-y-4 text-xs text-slate-500 leading-relaxed">
                <p>• 系統將依據 PDF 內容自動決定最大 Level N。</p>
                <p>• 渲染倍率鎖定為高品質基數 (2.0)。</p>
                <p>• 輸出結構完全相容於 OpenSeadragon。</p>
              </div>
              <button
                disabled={!pdfInstance || isProcessing}
                onClick={handleProcessTiles}
                className="w-full mt-8 bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-bold disabled:bg-slate-200 disabled:text-slate-400 shadow-lg transition-all flex items-center justify-center gap-3"
              >
                {isProcessing ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download size={20} />
                )}
                {isProcessing ? '正在執行重構邏輯...' : '產出瓦片包'}
              </button>
            </div>
          </div>

          {/* 右側預覽區 */}
          <div className="lg:col-span-2 space-y-4">
            {status.message && (
              <div
                className={`p-4 rounded-xl flex items-center gap-4 border-2 shadow-sm animate-in slide-in-from-top ${
                  status.type === 'success'
                    ? 'bg-green-50 border-green-100 text-green-700'
                    : 'bg-blue-50 border-blue-100 text-blue-700'
                }`}
              >
                {isProcessing ? (
                  <Loader2 className="animate-spin shrink-0" size={20} />
                ) : (
                  <CheckCircle2 className="shrink-0" size={20} />
                )}
                <div className="flex-1">
                  <p className="text-sm font-bold">{status.message}</p>
                  {isProcessing && (
                    <div className="w-full bg-blue-200 h-2 mt-2 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-600 h-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white p-6 rounded-2xl border shadow-sm min-h-[500px] flex flex-col">
              <h2 className="font-bold text-slate-800 flex items-center gap-2 text-lg mb-6">
                瓦片產出預覽
              </h2>

              {previews.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-slate-100 rounded-xl overflow-y-auto max-h-[600px]">
                  {previews.map((tile, i) => (
                    <div
                      key={i}
                      className="group relative border bg-white rounded-lg overflow-hidden shadow-sm"
                    >
                      <img
                        src={tile.url}
                        alt="tile"
                        className="w-full h-auto block"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-1">
                        <p className="text-[9px] text-white text-center font-mono">
                          {tile.label}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-50 rounded-2xl m-2">
                  <Layers size={64} className="opacity-10 mb-4" />
                  <p className="text-sm">尚未有產出資料</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 'use client';

// import React, { useState } from 'react';
// import { Document, Page as PdfPage, pdfjs } from 'react-pdf';
// import 'react-pdf/dist/Page/TextLayer.css';
// import 'react-pdf/dist/Page/AnnotationLayer.css';

// // Use the ESM worker bundled via your build tool (avoids relying on unpkg and mixed-content issues)
// pdfjs.GlobalWorkerOptions.workerSrc = new URL(
//   'pdfjs-dist/build/pdf.worker.min.mjs',
//   import.meta.url
// ).toString();

// export default function PdfViewer() {
//   const [numPages, setNumPages] = useState();
//   const [pageNumber, setPageNumber] = useState(1);

//   function onDocumentLoadSuccess({ numPages }) {
//     setNumPages(numPages);
//   }

//   const crop = { x: 0, y: 0, width: 300, height: 300 };

//   return (
//     <div>
//       <Document
//         file="/test.pdf"
//         width={window.innerWidth}
//         height={window.innerHeight}
//         onLoadSuccess={onDocumentLoadSuccess}
//       >
//         <PdfPage
//           pageNumber={pageNumber}
//           width={window.innerWidth}
//           height={window.innerHeight}
//         />
//       </Document>
//       <p>
//         Page {pageNumber} of {numPages}
//       </p>
//     </div>
//   );
// }
