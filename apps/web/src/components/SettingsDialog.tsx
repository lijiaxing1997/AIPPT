import { useMemo, useState, type ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Image, Network, Palette, X } from "lucide-react";

import { api, type AppConfigResponse } from "../lib/api";
import { cn } from "../lib/cn";
import { getCurrentTheme, setTheme, type ThemeMode } from "../lib/theme";
import { Button } from "./Button";
import { Input } from "./Input";

type SettingsTab = "theme" | "ai" | "image" | "proxy";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
    enabled: open,
  });

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getCurrentTheme());
  const [activeTab, setActiveTab] = useState<SettingsTab>("ai");

  const canSave = useMemo(() => {
    if (!open) return false;
    if (configQuery.isLoading || !configQuery.data) return false;
    return true;
  }, [configQuery.data, configQuery.isLoading, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-border/70 bg-panel shadow-soft">
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div className="text-sm font-semibold">设置</div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-[540px]">
          <aside className="w-56 border-r border-border/70 bg-panel2/20 p-3">
            <nav className="space-y-1">
              <NavItem icon={Palette} label="主题设置" active={activeTab === "theme"} onClick={() => setActiveTab("theme")} />
              <NavItem icon={Bot} label="AI设置" active={activeTab === "ai"} onClick={() => setActiveTab("ai")} />
              <NavItem icon={Image} label="生图设置" active={activeTab === "image"} onClick={() => setActiveTab("image")} />
              <NavItem icon={Network} label="代理设置" active={activeTab === "proxy"} onClick={() => setActiveTab("proxy")} />
            </nav>
            <div className="mt-3 rounded-lg border border-border/70 bg-panel2/40 p-2 text-xs text-muted">
              配置仅保存在本机。
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {configQuery.data ? (
              <SettingsForm
                key={JSON.stringify(configQuery.data)}
                config={configQuery.data}
                canSave={canSave}
                onClose={onClose}
                activeTab={activeTab}
                themeMode={themeMode}
                setThemeMode={(m) => {
                  setTheme(m);
                  setThemeMode(m);
                }}
              />
            ) : (
              <div className="p-4">
                <div className="rounded-lg border border-border/70 bg-panel2/40 p-3 text-sm text-muted">
                  {configQuery.isLoading ? "正在加载配置…" : configQuery.isError ? (configQuery.error as Error).message : "配置不可用"}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-accent/70",
        active ? "border-border/70 bg-panel2/70 text-text" : "border-transparent text-muted hover:bg-panel2/50 hover:text-text",
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function SettingsForm({
  config,
  canSave,
  onClose,
  activeTab,
  themeMode,
  setThemeMode,
}: {
  config: AppConfigResponse;
  canSave: boolean;
  onClose: () => void;
  activeTab: SettingsTab;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}) {
  const queryClient = useQueryClient();

  const [openAiBaseUrl, setOpenAiBaseUrl] = useState(config.openai.baseURL || "");
  const [openAiModel, setOpenAiModel] = useState(config.openai.model || "");
  const [openAiApiKey, setOpenAiApiKey] = useState("");

  const [imageBaseUrl, setImageBaseUrl] = useState(config.image.baseURL || "");
  const [imageAspectRatio, setImageAspectRatio] = useState(config.image.aspectRatio || "16:9");
  const [imageSize, setImageSize] = useState(config.image.imageSize || "2K");
  const [imageTimeoutSec, setImageTimeoutSec] = useState(String(config.image.timeoutSec || 120));
  const [imageCacheEnabled, setImageCacheEnabled] = useState(Boolean(config.image.cacheEnabled));
  const [imageApiKey, setImageApiKey] = useState("");

  const [proxyEnabled, setProxyEnabled] = useState(Boolean(config.proxy.enabled));
  const [proxyHost, setProxyHost] = useState(config.proxy.host || "");
  const [proxyPort, setProxyPort] = useState(String(config.proxy.port || 0));

  const hasOpenAiKey = Boolean(config.openai.hasApiKey);
  const hasImageKey = Boolean(config.image.hasApiKey);

  const updateMutation = useMutation({
    mutationFn: api.updateConfig,
    onSuccess: async () => {
      setOpenAiApiKey("");
      setImageApiKey("");
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      await queryClient.invalidateQueries({ queryKey: ["boot"] });
      onClose();
    },
  });

  const title =
    activeTab === "theme"
      ? "主题设置"
      : activeTab === "ai"
        ? "AI设置"
        : activeTab === "image"
          ? "生图设置"
          : "代理设置";

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-4">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs text-muted">
            {activeTab === "theme"
              ? "主题仅保存在本机。"
              : activeTab === "proxy"
                ? "代理将用于 AI 与生图的网络请求。"
                : null}
          </div>
        </div>

        {activeTab === "theme" ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant={themeMode === "light" ? "default" : "ghost"} type="button" onClick={() => setThemeMode("light")}>
                日间模式
              </Button>
              <Button size="sm" variant={themeMode === "dark" ? "default" : "ghost"} type="button" onClick={() => setThemeMode("dark")}>
                夜间模式
              </Button>
            </div>
          </section>
        ) : null}

        {activeTab === "ai" ? (
          <section className="space-y-3">
            <label className="block space-y-1">
              <div className="text-xs text-muted">接口地址</div>
              <Input value={openAiBaseUrl} onChange={(e) => setOpenAiBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
            </label>
            <label className="block space-y-1">
              <div className="text-xs text-muted">模型</div>
              <Input value={openAiModel} onChange={(e) => setOpenAiModel(e.target.value)} placeholder="gpt-4.1-mini" />
            </label>
            <label className="block space-y-1">
              <div className="text-xs text-muted">密钥</div>
              <Input
                value={openAiApiKey}
                onChange={(e) => setOpenAiApiKey(e.target.value)}
                placeholder={hasOpenAiKey ? "已设置（留空则不修改）" : "sk-..."}
                type="password"
                autoComplete="off"
              />
            </label>
          </section>
        ) : null}

        {activeTab === "image" ? (
          <section className="space-y-3">
            <label className="block space-y-1">
              <div className="text-xs text-muted">接口地址</div>
              <Input value={imageBaseUrl} onChange={(e) => setImageBaseUrl(e.target.value)} placeholder="https://api.vectorengine.ai/v1beta/models/..:generateContent" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <div className="text-xs text-muted">画幅比例</div>
                <Input value={imageAspectRatio} onChange={(e) => setImageAspectRatio(e.target.value)} placeholder="16:9" />
              </label>
              <label className="block space-y-1">
                <div className="text-xs text-muted">图片尺寸</div>
                <Input value={imageSize} onChange={(e) => setImageSize(e.target.value)} placeholder="2K" />
              </label>
            </div>
            <label className="block space-y-1">
              <div className="text-xs text-muted">超时（秒）</div>
              <Input value={imageTimeoutSec} onChange={(e) => setImageTimeoutSec(e.target.value)} placeholder="120" inputMode="numeric" />
            </label>
            <label className="flex items-center justify-between rounded-md border border-border/70 bg-panel2/40 px-3 py-2">
              <div className="text-xs text-muted">启用缓存（本地）</div>
              <input
                type="checkbox"
                checked={imageCacheEnabled}
                onChange={(e) => setImageCacheEnabled(e.target.checked)}
                className="h-4 w-4 accent-[color:var(--accent)]"
              />
            </label>
            <label className="block space-y-1">
              <div className="text-xs text-muted">访问令牌</div>
              <Input
                value={imageApiKey}
                onChange={(e) => setImageApiKey(e.target.value)}
                placeholder={hasImageKey ? "已设置（留空则不修改）" : "sk-..."}
                type="password"
                autoComplete="off"
              />
            </label>
          </section>
        ) : null}

        {activeTab === "proxy" ? (
          <section className="space-y-3">
            <label className="flex items-center justify-between rounded-md border border-border/70 bg-panel2/40 px-3 py-2">
              <div className="text-xs text-muted">启用代理</div>
              <input
                type="checkbox"
                checked={proxyEnabled}
                onChange={(e) => setProxyEnabled(e.target.checked)}
                className="h-4 w-4 accent-[color:var(--accent)]"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <div className="text-xs text-muted">代理 IP/域名</div>
                <Input value={proxyHost} onChange={(e) => setProxyHost(e.target.value)} placeholder="127.0.0.1" />
              </label>
              <label className="block space-y-1">
                <div className="text-xs text-muted">端口</div>
                <Input value={proxyPort} onChange={(e) => setProxyPort(e.target.value)} placeholder="7890" inputMode="numeric" />
              </label>
            </div>
            <div className="rounded-lg border border-border/70 bg-panel2/40 p-3 text-xs text-muted">
              目前仅支持 HTTP 代理（通过 CONNECT 转发 HTTPS）。
            </div>
          </section>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          {updateMutation.isError ? <div className="text-xs text-accent2">{(updateMutation.error as Error).message}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={() => {
              const timeoutSec = Number(imageTimeoutSec);
              const safeTimeoutSec = Number.isFinite(timeoutSec) && timeoutSec > 0 ? Math.floor(timeoutSec) : 120;
              const portNum = Number(proxyPort);
              const safePort = Number.isFinite(portNum) ? Math.floor(portNum) : 0;
              updateMutation.mutate({
                openai: { baseURL: openAiBaseUrl, model: openAiModel, apiKey: openAiApiKey },
                image: {
                  baseURL: imageBaseUrl,
                  aspectRatio: imageAspectRatio,
                  imageSize,
                  timeoutSec: safeTimeoutSec,
                  cacheEnabled: imageCacheEnabled,
                  apiKey: imageApiKey,
                },
                proxy: {
                  enabled: proxyEnabled,
                  host: proxyHost,
                  port: safePort,
                },
              });
            }}
            disabled={!canSave || updateMutation.isPending}
          >
            保存
          </Button>
        </div>
      </div>
    </>
  );
}
