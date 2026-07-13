import { Search } from 'lucide-react';
import { ModuleScaffold } from '@/components/layout/ModuleScaffold';

export default function SearchPage() {
  return (
    <ModuleScaffold
      title="Repository Search"
      description="Search the full archive of processed invoices and supporting documents."
      icon={Search}
    />
  );
}
