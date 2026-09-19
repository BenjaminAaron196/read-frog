import "@/utils/zod-config"
import type { Config } from "@/types/config/config"
import type { ThemeMode } from "@/types/config/theme"
import { QueryClientProvider } from "@tanstack/react-query"
import { Provider as JotaiProvider } from "jotai"
import { useHydrateAtoms } from "jotai/utils"
import readFrogLogo from "@/assets/icons/read-frog.png?url&no-inline"
import { ThemeProvider } from "@/components/providers/theme-provider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/base-ui/tabs"
import { AnchoredToastProvider, ToastProvider } from "@/components/ui/base-ui/toast"
import { NotionConnection } from "@/components/word-book/notion-connection"
import { WordBookList } from "@/components/word-book/word-book-list"
import { configAtom } from "@/utils/atoms/config"
import { baseThemeModeAtom } from "@/utils/atoms/theme"
import { getLocalConfig } from "@/utils/config/storage"
import { APP_NAME } from "@/utils/constants/app"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { i18n, initI18n } from "@/utils/i18n"
import { LocaleBoundary } from "@/utils/i18n/locale-boundary"
import { renderPersistentReactRoot } from "@/utils/react-root"
import { queryClient } from "@/utils/tanstack-query"
import { getLocalThemeMode } from "@/utils/theme"
import "@fontsource-variable/inter/index.css"
import "@/assets/styles/text-small.css"
import "@/assets/styles/theme.css"

function HydrateAtoms({
  initialValues,
  children,
}: {
  initialValues: [[typeof configAtom, Config], [typeof baseThemeModeAtom, ThemeMode]]
  children: React.ReactNode
}) {
  useHydrateAtoms(initialValues)
  return children
}

/**
 * The word book beside the page it collects from. The two sections are the
 * same components the options page renders, so both surfaces stay in step.
 */
function SidePanelShell() {
  return (
    <main className="flex min-h-screen flex-col gap-4 bg-background px-4 py-5 text-foreground">
      <header className="flex items-center gap-2">
        <img src={readFrogLogo} alt={APP_NAME} className="size-6 rounded-full" />
        <h1 className="text-base font-semibold tracking-tight">{i18n.t("wordBook.panel.title")}</h1>
      </header>

      <Tabs defaultValue="words" className="gap-3">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="words" className="px-3 font-normal">
            {i18n.t("wordBook.panel.words")}
          </TabsTrigger>
          <TabsTrigger value="notion" className="px-3 font-normal">
            {i18n.t("wordBook.panel.notion")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="words" className="animate-in duration-200 ease-out fade-in-0">
          <WordBookList showHeading={false} />
        </TabsContent>
        <TabsContent value="notion" className="animate-in duration-200 ease-out fade-in-0">
          <NotionConnection showHeading={false} />
        </TabsContent>
      </Tabs>
    </main>
  )
}

async function initApp() {
  const root = document.getElementById("root")!
  root.className = "min-h-screen bg-background text-base antialiased"

  const [configValue, themeMode] = await Promise.all([getLocalConfig(), getLocalThemeMode()])
  const config = configValue ?? DEFAULT_CONFIG
  await initI18n(config.uiLanguage)

  renderPersistentReactRoot(
    root,
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <HydrateAtoms
          initialValues={[
            [configAtom, config],
            [baseThemeModeAtom, themeMode],
          ]}
        >
          <ThemeProvider>
            <LocaleBoundary>
              <ToastProvider>
                <AnchoredToastProvider>
                  <SidePanelShell />
                </AnchoredToastProvider>
              </ToastProvider>
            </LocaleBoundary>
          </ThemeProvider>
        </HydrateAtoms>
      </JotaiProvider>
    </QueryClientProvider>,
  )
}

void initApp()
