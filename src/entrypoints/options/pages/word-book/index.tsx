import { useAtom } from "jotai"
import { Switch } from "@/components/ui/base-ui/switch"
import { NotionConnection } from "@/components/word-book/notion-connection"
import { WordBookList } from "@/components/word-book/word-book-list"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import { ConfigItem } from "../../components/config-item"
import { PageLayout } from "../../components/page-layout"

function WordBookEnableItem() {
  const [wordBook, setWordBook] = useAtom(configFieldsAtomMap.wordBook)

  return (
    <ConfigItem
      title={i18n.t("wordBook.panel.enable")}
      description={i18n.t("wordBook.panel.empty")}
      orientation="horizontal"
    >
      <Switch
        checked={wordBook.enabled}
        onCheckedChange={(checked) => void setWordBook({ ...wordBook, enabled: checked })}
      />
    </ConfigItem>
  )
}

export function WordBookPage() {
  return (
    <PageLayout
      title={i18n.t("wordBook.panel.title")}
      description={i18n.t("wordBook.panel.description")}
      innerClassName="flex flex-col gap-10"
    >
      <WordBookEnableItem />
      <NotionConnection />
      <WordBookList />
    </PageLayout>
  )
}
