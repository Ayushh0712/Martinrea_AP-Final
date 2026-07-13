import { BarChart3 } from 'lucide-react';
import { ModuleScaffold } from '@/components/layout/ModuleScaffold';

export default function AnalyticsPage() {
  return (
    <ModuleScaffold
      title="Analytics"
      description="Monitor throughput, cycle time, and spend across plants."
      icon={BarChart3}
    />
  );
}
