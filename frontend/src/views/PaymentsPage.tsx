import { CreditCard } from 'lucide-react';
import { ModuleScaffold } from '@/components/layout/ModuleScaffold';

export default function PaymentsPage() {
  return (
    <ModuleScaffold
      title="Payment Packages"
      description="Bundle approved invoices into payment runs for the treasury team."
      icon={CreditCard}
    />
  );
}
