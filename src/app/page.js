import Link from 'next/link';
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/uploadPage');

  return (
    <div className=" min-h-screen bg-zinc-50 font-sans ">
      <main className="flex  min-h-screen w-full max-w-3xl  items-center justify-center py-32 px-16 bg-white dark:bg-zinc-50 sm:items-start gap-4 mx-auto">
        <Link
          href="/uploadPage"
          className="text-3xl text-black underline underline-offset-3 "
        >
          上傳PDF
        </Link>
        <Link
          href="/pdfViewerPage"
          className="text-3xl text-black underline underline-offset-3"
        >
          圖片縮放頁
        </Link>
      </main>
    </div>
  );
}
