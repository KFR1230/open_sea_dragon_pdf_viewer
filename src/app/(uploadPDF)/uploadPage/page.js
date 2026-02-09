'use client';
import dynamic from 'next/dynamic';
import React from 'react';

const PdfViewer = dynamic(() => import('../../component/PdfViewer.js'), {
  ssr: false,
});

export default function Page() {
  return <PdfViewer />;
}
