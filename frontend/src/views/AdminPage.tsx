import { Settings } from 'lucide-react';
import { ModuleScaffold } from '@/components/layout/ModuleScaffold';

export default function AdminPage() {
  return (
    <ModuleScaffold
      title="Admin Panel"
      description="Manage users, roles, routing rules, and system configuration."
      icon={Settings}
    />
  );
}
