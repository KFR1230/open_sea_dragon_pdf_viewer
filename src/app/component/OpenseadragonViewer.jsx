'use client';
import OpenSeadragon from 'openseadragon';
import React, { useEffect, useRef } from 'react';

export default function OpenSeadragonViewer({ href }) {
  const viewerRef = useRef(null);

  useEffect(() => {
    const viewer = OpenSeadragon({
      id: 'viewer',
      showFullPageControl: false,
      showHomeControl: false,
      showZoomControl: false,
      showNavigator: true,
      // Zoom 倍率調整（OSD 的倍率是「每次縮放的比例」）
      zoomPerScroll: 1.15, // 滾輪每一格縮放倍率（>1 越大越敏感）
      zoomPerClick: 1.15, // UI 的 + / - 每次縮放倍率
      minZoomLevel: 0.0625, // 最小可縮放（1 代表 100%）
      maxZoomLevel: 13, // 最大可縮放
      defaultZoomLevel: 1, // 初始倍率
      visibilityRatio: 1, // 盡量不要拖出邊界（1 = 不能看到黑邊）

      // 限制同時載入與快取，避免快速縮放/拖移時記憶體暴衝導致瀏覽器崩潰
      imageLoaderLimit: 4,
      maxImageCacheCount: 40,
      maxTileCacheCount: 600,
      blendTime: 0,
      immediateRender: true,
      // 減少動畫帶來的額外重繪
      animationTime: 0.2,

      constrainDuringPan: true,
      navigatorPosition: 'TOP_LEFT',
      showNavigationControl: true,
      navigationControlAnchor: OpenSeadragon.ControlAnchor.TOP_RIGHT,
      prefixUrl: '',
      // 單張圖模式
      // tileSources: {
      //   type: 'image',
      //   url: '/tiles/0/0_0.png',
      // },
    });
    viewerRef.current = viewer;

    return () => {
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (!href) return;

    let cancelled = false;

    const openTileSource = async () => {
      try {
        // 清掉上一張，避免 world 疊一堆 item
        viewer.close();

        // 如果是自訂的 JSON 設定檔，先 fetch 再轉成 OSD 可吃的 tileSource 物件
        if (typeof href === 'string' && href.endsWith('.json')) {
          console.log('[OpenSeadragon] loading tile config:', href);
          const res = await fetch(href, { cache: 'no-store' });
          if (!res.ok)
            throw new Error(`Failed to fetch tile config: ${res.status}`);
          const cfg = await res.json();
          console.log('[OpenSeadragon] tile config json:', cfg);

          // 預期 cfg 形狀：
          // { width, height, tileSize, tileOverlap, maxLevel, tilesUrl, format }
          const {
            width,
            height,
            tileSize = 256,
            tileOverlap = 0,
            maxLevel,
            tilesUrl = '/tiles',
            format = 'png',
          } = cfg.tileSources || {};

          if (
            !width ||
            !height ||
            maxLevel === undefined ||
            maxLevel === null
          ) {
            throw new Error(
              'Invalid tile config json: missing width/height/maxLevel'
            );
          }

          const tileSource = {
            width,
            height,
            tileSize,
            tileOverlap,
            minLevel: 0,
            maxLevel,
            getTileUrl: (level, x, y) =>
              `${tilesUrl}/${level}/${x}_${y}.${format}`,
          };

          if (cancelled) return;
          viewer.open(tileSource);
          return;
        }

        // 其他情況：交給 OSD 自己判斷 (DZI / IIIF / Zoomify / 單張圖等)
        if (cancelled) return;
        viewer.open(href);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : '';
        console.error('[OpenSeadragon] open tileSource failed:', message);
        if (stack) console.error(stack);
      }
    };

    openTileSource();

    return () => {
      cancelled = true;
    };
  }, [href]);

  return (
    <div
      id="viewer"
      style={{ margin: '0 auto', width: '100%', height: '100%' }}
    />
  );
}
