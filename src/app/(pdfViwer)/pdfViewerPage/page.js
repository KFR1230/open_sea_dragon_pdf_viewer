'use client';

import dynamic from 'next/dynamic';
import React from 'react';

if (process.env.NODE_ENV === 'development') {
  console.log('dd');
  const wrap =
    (fn) =>
    (...args) => {
      const safe = args.map((a) => {
        if (typeof a === 'string') {
          return a.length > 1000 ? a.slice(0, 1000) + `…(len=${a.length})` : a;
        }
        // if (a && typeof a === 'object') {
        //   return '[object suppressed]';
        // }
        return a;
      });
      return fn(...safe);
    };

  console.log = wrap(console.log);
  console.warn = wrap(console.warn);
  console.error = wrap(console.error);
}

const OpenSeadragonViewer = dynamic(
  () => import('../../component/OpenseadragonViewer'),
  {
    ssr: false,
  }
);

export default function Page() {
  return (
    <div className="bg-black h-full w-full pt-14">
      <OpenSeadragonViewer href={`/tiles/osd_config.json`} />
    </div>
  );
}
