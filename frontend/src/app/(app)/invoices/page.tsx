import { Suspense } from 'react';
import InvoiceProcessingPage from '@/views/InvoiceProcessingPage';

// InvoiceProcessingPage reads `useSearchParams`, which Next requires to sit
// inside a Suspense boundary during prerendering.
export default function Page() {
  return (
    <Suspense>
      <InvoiceProcessingPage />
    </Suspense>
  );
}
