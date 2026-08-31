"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/error-state";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  useSendTestEmail,
  useSystemSettings,
  useUpdateSystemSetting,
} from "@/hooks/use-system-settings";
import { SYSTEM_SETTING_CATEGORIES, categoryLabel, type SystemSetting } from "@/lib/schemas/system-settings";
import { ApiError } from "@/lib/api/client";

function SettingRow({ setting }: { setting: SystemSetting }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(setting.value);
  const updateMutation = useUpdateSystemSetting();
  const isBool = setting.value_type === "bool" || setting.value_type === "boolean";
  const isSecret = setting.key.toLowerCase().includes("password");

  async function save(nextValue: string) {
    try {
      await updateMutation.mutateAsync({ key: setting.key, value: nextValue });
      toast.success(`${setting.key} updated`);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update setting");
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{setting.key}</p>
        {setting.description ? (
          <p className="text-muted-foreground truncate text-xs">{setting.description}</p>
        ) : null}
      </div>

      {isBool ? (
        <Switch
          checked={setting.value === "true"}
          disabled={updateMutation.isPending}
          onCheckedChange={(checked) => save(checked ? "true" : "false")}
        />
      ) : editing ? (
        <div className="flex items-center gap-1.5">
          <Input
            className="h-8 w-40"
            type={isSecret ? "password" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={updateMutation.isPending}
            autoFocus
          />
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            disabled={updateMutation.isPending}
            onClick={() => save(value)}
            aria-label="Save"
          >
            {updateMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            disabled={updateMutation.isPending}
            onClick={() => {
              setValue(setting.value);
              setEditing(false);
            }}
            aria-label="Cancel"
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="text-sm tabular-nums">
            {isSecret ? (setting.value ? "••••••••" : "—") : setting.value || "—"}
          </span>
          <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditing(true)} aria-label="Edit">
            <Pencil className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function TestEmailCard() {
  const [to, setTo] = useState("");
  const testMutation = useSendTestEmail();

  async function send() {
    try {
      const result = await testMutation.mutateAsync(to.trim());
      toast.success(`Test email sent to ${result.sent_to}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Couldn't send the test email");
    }
  }

  return (
    <Card className="mb-4">
      <CardContent className="flex flex-col gap-2 pt-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <p className="text-sm font-medium">Send a test email</p>
          <p className="text-muted-foreground text-xs">
            Save the SMTP settings below first, then confirm they work.
          </p>
          <Input
            type="email"
            placeholder="you@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Button onClick={send} disabled={testMutation.isPending || !to.includes("@")}>
          {testMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Send test
        </Button>
      </CardContent>
    </Card>
  );
}

function CategoryPanel({ settings }: { settings: SystemSetting[] }) {
  if (settings.length === 0) {
    return <EmptyState title="No settings in this category" />;
  }
  return (
    <>
      {settings[0]?.category === "Email" ? <TestEmailCard /> : null}
      <Card>
        <CardContent className="pt-4">
          {settings.map((s) => (
            <SettingRow key={s.id} setting={s} />
          ))}
        </CardContent>
      </Card>
    </>
  );
}

export default function SystemSettingsPage() {
  const { data, isLoading, isError, error, refetch } = useSystemSettings();

  const byCategory = useMemo(() => {
    const map = new Map<string, SystemSetting[]>();
    for (const s of data ?? []) {
      const list = map.get(s.category) ?? [];
      list.push(s);
      map.set(s.category, list);
    }
    return map;
  }, [data]);

  const categories = useMemo(() => {
    const present = Array.from(byCategory.keys());
    const ordered = SYSTEM_SETTING_CATEGORIES.filter((c) => present.includes(c));
    const extra = present.filter((c) => !SYSTEM_SETTING_CATEGORIES.includes(c as never));
    return [...ordered, ...extra];
  }, [byCategory]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Settings"
        description="Business-rule defaults grouped by category (doc 04). Every change is audited."
      />

      {isLoading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <ErrorState error={error} title="Couldn't load system settings" onRetry={() => refetch()} />
      ) : categories.length === 0 ? (
        <EmptyState title="No system settings configured yet" />
      ) : (
        <Tabs defaultValue={categories[0]}>
          <TabsList>
            {categories.map((c) => (
              <TabsTrigger key={c} value={c}>
                {categoryLabel(c)}
              </TabsTrigger>
            ))}
          </TabsList>
          {categories.map((c) => (
            <TabsContent key={c} value={c}>
              <CategoryPanel settings={byCategory.get(c) ?? []} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
