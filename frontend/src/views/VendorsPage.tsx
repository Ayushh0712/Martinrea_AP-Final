import { Store } from 'lucide-react';
import { ModuleScaffold } from '@/components/layout/ModuleScaffold';

export default function VendorsPage() {
  return (
    <ModuleScaffold
      title="Vendor Portal"
      description="Manage supplier profiles, banking details, and self-service submissions."
      icon={Store}
    />
  );
}
