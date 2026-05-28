"use client";

import { useState } from "react";

type Variant = "split" | "tabs" | "rail";

interface FormState {
  enabled: boolean;
  dryRun: boolean;
  targetFrom: number;
  targetTo: number;
  minBid: number;
  maxBid: number;
  stepUp: number;
  stepDown: number;
  interval: number;
  cooldown: number;
  economy: boolean;
  economyChecks: number;
  economyStep: number;
  failPause: number;
}

const initial: FormState = {
  enabled: true,
  dryRun: false,
  targetFrom: 1,
  targetTo: 1,
  minBid: 405,
  maxBid: 740,
  stepUp: 20,
  stepDown: 10,
  interval: 5,
  cooldown: 2,
  economy: true,
  economyChecks: 2,
  economyStep: 15,
  failPause: 20,
};

const checks = [
  { time: "23:21", pos: 1, was: 630, now: 630, action: "hold", tone: "muted" },
  { time: "23:16", pos: 1, was: 645, now: 630, action: "lower_probe", tone: "good" },
  { time: "23:11", pos: 1, was: 645, now: 645, action: "hold", tone: "muted" },
  { time: "23:06", pos: 2, was: 625, now: 645, action: "rollback", tone: "warn" },
  { time: "22:58", pos: 1, was: 640, now: 625, action: "lower_probe", tone: "good" },
];

const diary = [
  {
    title: "Ставка держит первую позицию",
    text: "Последняя проверка успешная: позиция 1, ставка 630 ₽. Система может продолжить осторожную экономию, если позиция останется стабильной.",
  },
  {
    title: "Проверить цену лидерства",
    text: "Если снижение до 615-620 ₽ сохранит позицию 1, лимит 740 ₽ можно считать запасом, а не рабочей ставкой.",
  },
];

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function CompactNumber({
  label,
  value,
  onChange,
  suffix,
  min = 0,
  max = 1500,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block truncate text-[10px] uppercase text-[var(--text-muted)]">{label}</span>
      <div className="flex h-8 items-center rounded border border-[var(--border)] bg-[var(--bg)] focus-within:border-[var(--accent)]">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (!Number.isFinite(n)) return;
            onChange(Math.max(min, Math.min(max, n)));
          }}
          className="min-w-0 flex-1 bg-transparent px-2 text-sm font-semibold text-[var(--text)] outline-none"
        />
        {suffix && <span className="pr-2 text-xs text-[var(--text-muted)]">{suffix}</span>}
      </div>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex h-8 min-w-0 items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg)] px-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="truncate">{label}</span>
    </label>
  );
}

function Header({ compact }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--text)]">Автоставка</div>
        <div className="truncate text-xs text-[var(--text-muted)]">3. Слипы РУБЧИК 7шт - ПОИСК</div>
        <div className="mt-1 truncate font-mono text-sm text-[var(--accent)]">трусы женский</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[10px] uppercase text-[var(--text-muted)]">Текущая</div>
        <div className={cx("font-mono font-semibold text-[var(--text)]", compact ? "text-base" : "text-lg")}>630 ₽</div>
      </div>
    </div>
  );
}

function StatusStrip() {
  return (
    <div className="grid grid-cols-3 gap-2 text-xs">
      <div className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5">
        <div className="text-[10px] uppercase text-[var(--text-muted)]">Позиция</div>
        <div className="font-mono text-[var(--success)]">1</div>
      </div>
      <div className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5">
        <div className="text-[10px] uppercase text-[var(--text-muted)]">Действие</div>
        <div className="font-mono">hold</div>
      </div>
      <div className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5">
        <div className="text-[10px] uppercase text-[var(--text-muted)]">Проверка</div>
        <div className="font-mono">23:21</div>
      </div>
    </div>
  );
}

function MainFields({ state, setState, dense = false }: { state: FormState; setState: (s: FormState) => void; dense?: boolean }) {
  const cols = dense ? "grid-cols-4" : "grid-cols-2";
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState({ ...state, [key]: value });
  return (
    <div className={cx("grid gap-2", cols)}>
      <CompactNumber label="Поз. от" value={state.targetFrom} onChange={(v) => set("targetFrom", v)} max={100} />
      <CompactNumber label="Поз. до" value={state.targetTo} onChange={(v) => set("targetTo", v)} max={100} />
      <CompactNumber label="Мин." value={state.minBid} onChange={(v) => set("minBid", v)} suffix="₽" min={405} />
      <CompactNumber label="Макс." value={state.maxBid} onChange={(v) => set("maxBid", v)} suffix="₽" min={405} />
      <CompactNumber label="Вверх" value={state.stepUp} onChange={(v) => set("stepUp", v)} suffix="₽" max={500} />
      <CompactNumber label="Вниз" value={state.stepDown} onChange={(v) => set("stepDown", v)} suffix="₽" max={500} />
      <CompactNumber label="Интервал" value={state.interval} onChange={(v) => set("interval", v)} suffix="мин" min={1} max={1440} />
      <CompactNumber label="Пауза" value={state.cooldown} onChange={(v) => set("cooldown", v)} suffix="мин" min={2} max={1440} />
    </div>
  );
}

function EconomyFields({ state, setState, dense = false }: { state: FormState; setState: (s: FormState) => void; dense?: boolean }) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState({ ...state, [key]: value });
  return (
    <div className="space-y-2">
      <Toggle label="Экономить внутри диапазона" checked={state.economy} onChange={(v) => set("economy", v)} />
      <div className={cx("grid gap-2", dense ? "grid-cols-3" : "grid-cols-2")}>
        <CompactNumber label="Успешных" value={state.economyChecks} onChange={(v) => set("economyChecks", v)} min={1} max={20} />
        <CompactNumber label="Шаг экономии" value={state.economyStep} onChange={(v) => set("economyStep", v)} suffix="₽" max={500} />
        <CompactNumber label="После провала" value={state.failPause} onChange={(v) => set("failPause", v)} suffix="мин" min={1} max={1440} />
      </div>
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        Если позиция держится в цели, система пробует снизить ставку. При просадке возвращает последнюю рабочую.
      </p>
    </div>
  );
}

function HistoryTable({ compact = false }: { compact?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-[10px] font-semibold uppercase text-[var(--text-muted)]">Последние проверки</div>
      <div className={cx("overflow-y-auto rounded border border-[var(--border)]", compact ? "max-h-40" : "max-h-52")}>
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-[var(--bg)] text-[10px] uppercase text-[var(--text-muted)]">
            <tr>
              <th className="px-2 py-1 text-left">Время</th>
              <th className="px-2 py-1 text-right">Поз</th>
              <th className="px-2 py-1 text-right">Ставка</th>
              <th className="px-2 py-1 text-left">Действие</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((row) => (
              <tr key={`${row.time}-${row.action}`} className="border-t border-[var(--border)]/70">
                <td className="px-2 py-1 font-mono text-[var(--text-muted)]">{row.time}</td>
                <td className="px-2 py-1 text-right font-mono">{row.pos}</td>
                <td className="px-2 py-1 text-right font-mono">{row.was === row.now ? row.now : `${row.was}->${row.now}`} ₽</td>
                <td className={cx("px-2 py-1 font-mono", row.tone === "good" && "text-[var(--success)]", row.tone === "warn" && "text-[var(--warning)]", row.tone === "muted" && "text-[var(--text-muted)]")}>{row.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiaryBlock({ compact = false }: { compact?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">ИИ-дневник</div>
        <button className="h-7 rounded border border-[var(--border)] px-2 text-xs hover:bg-[var(--bg-card-hover)]">Обновить</button>
      </div>
      <div className={cx("space-y-2 overflow-y-auto", compact ? "max-h-40" : "max-h-52")}>
        {diary.map((item) => (
          <div key={item.title} className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-xs">
            <div className="font-semibold text-[var(--text)]">{item.title}</div>
            <div className="mt-1 leading-relaxed text-[var(--text-muted)]">{item.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
      <button className="h-9 rounded border border-[var(--border)] px-4 text-sm hover:bg-[var(--bg-card-hover)]">Отмена</button>
      <button className="h-9 rounded bg-[var(--accent)] px-4 text-sm font-semibold text-white hover:opacity-90">Сохранить</button>
    </div>
  );
}

function SplitVariant({ state, setState }: { state: FormState; setState: (s: FormState) => void }) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState({ ...state, [key]: value });
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <VariantTitle
        n="1"
        title="Две колонки"
        text="Основные настройки слева, состояние, история и дневник справа. Самый близкий вариант к текущей модалке."
      />
      <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-2xl">
        <Header />
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(300px,0.9fr)_minmax(320px,1.1fr)]">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Toggle label="Включить" checked={state.enabled} onChange={(v) => set("enabled", v)} />
              <Toggle label="Dry-run" checked={state.dryRun} onChange={(v) => set("dryRun", v)} />
            </div>
            <MainFields state={state} setState={setState} />
            <EconomyFields state={state} setState={setState} />
          </div>
          <div className="space-y-3">
            <StatusStrip />
            <HistoryTable />
            <DiaryBlock compact />
          </div>
        </div>
        <div className="mt-4"><Footer /></div>
      </div>
    </section>
  );
}

function TabsVariant({ state, setState }: { state: FormState; setState: (s: FormState) => void }) {
  const [tab, setTab] = useState<"rule" | "economy" | "log">("rule");
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState({ ...state, [key]: value });
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <VariantTitle
        n="2"
        title="Компактные вкладки"
        text="На первом экране только самое частое. Экономия, история и дневник открываются вкладками внутри окна."
      />
      <div className="mt-3 max-w-[560px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-2xl">
        <Header compact />
        <div className="mt-3 flex rounded border border-[var(--border)] bg-[var(--bg)] p-0.5 text-xs">
          {[
            ["rule", "Правило"],
            ["economy", "Экономия"],
            ["log", "Журнал"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key as "rule" | "economy" | "log")}
              className={cx("h-7 flex-1 rounded px-2", tab === key ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3">
          {tab === "rule" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Toggle label="Включить" checked={state.enabled} onChange={(v) => set("enabled", v)} />
                <Toggle label="Dry-run" checked={state.dryRun} onChange={(v) => set("dryRun", v)} />
              </div>
              <MainFields state={state} setState={setState} dense />
              <StatusStrip />
            </div>
          )}
          {tab === "economy" && <EconomyFields state={state} setState={setState} dense />}
          {tab === "log" && (
            <div className="grid gap-3 md:grid-cols-2">
              <HistoryTable compact />
              <DiaryBlock compact />
            </div>
          )}
        </div>
        <div className="mt-4"><Footer /></div>
      </div>
    </section>
  );
}

function RailVariant({ state, setState }: { state: FormState; setState: (s: FormState) => void }) {
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState({ ...state, [key]: value });
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <VariantTitle
        n="3"
        title="Широкая панель"
        text="Окно вытянуто вширь: слева плотная форма, по центру экономика, справа журнал и ИИ."
      />
      <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-2xl">
        <Header compact />
        <div className="mt-4 grid gap-4 xl:grid-cols-[360px_300px_minmax(360px,1fr)]">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Toggle label="Включить" checked={state.enabled} onChange={(v) => set("enabled", v)} />
              <Toggle label="Dry-run" checked={state.dryRun} onChange={(v) => set("dryRun", v)} />
            </div>
            <MainFields state={state} setState={setState} dense />
          </div>
          <div className="space-y-3">
            <StatusStrip />
            <EconomyFields state={state} setState={setState} />
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            <HistoryTable compact />
            <DiaryBlock compact />
          </div>
        </div>
        <div className="mt-4"><Footer /></div>
      </div>
    </section>
  );
}

function VariantTitle({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--accent)] text-sm font-bold text-white">{n}</div>
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--text-muted)]">{text}</p>
      </div>
    </div>
  );
}

export default function BidAutoLayoutDebugPage() {
  const [state, setState] = useState<FormState>(initial);
  const [active, setActive] = useState<Variant>("split");

  return (
    <main className="min-h-screen bg-[var(--bg)] p-4 text-[var(--text)] md:p-6">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-5 flex flex-col gap-3 border-b border-[var(--border)] pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-xl font-bold">Тест компактной автоставки</h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--text-muted)]">
              Три варианта окна на демо-данных. Поля редактируются локально, реальные правила и ставки не меняются.
            </p>
          </div>
          <div className="flex rounded border border-[var(--border)] bg-[var(--bg-card)] p-1 text-sm">
            {[
              ["split", "1"],
              ["tabs", "2"],
              ["rail", "3"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActive(key as Variant)}
                className={cx("h-8 w-10 rounded", active === key ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          {active === "split" && <SplitVariant state={state} setState={setState} />}
          {active === "tabs" && <TabsVariant state={state} setState={setState} />}
          {active === "rail" && <RailVariant state={state} setState={setState} />}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 text-sm">
            <div className="font-semibold">Вариант 1</div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">Лучший баланс: всё видно сразу, окно шире, но без вкладок. Удобно для частой настройки.</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 text-sm">
            <div className="font-semibold">Вариант 2</div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">Самый компактный. Подходит, если журнал и ИИ нужны не каждый раз.</p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 text-sm">
            <div className="font-semibold">Вариант 3</div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">Самый рабочий для широкого экрана: настройки, экономика и анализ одновременно.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
