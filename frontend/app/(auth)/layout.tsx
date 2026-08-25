import { GraduationCap } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 flex min-h-screen flex-col items-center justify-center gap-8 p-4">
      <div className="text-primary flex items-center gap-2 text-lg font-semibold">
        <GraduationCap className="size-6" />
        EduManage
      </div>
      {children}
    </div>
  );
}
