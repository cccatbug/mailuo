import { Bot, ListChecks, ShieldCheck, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppStore } from "@/store/useAppStore";
import type { AssistantPermissionMode } from "@/shared/assistant";

/** 权限与行为设置内容（供独立面板与统一「小枢」面板复用）。 */
export function AssistantPermissionsSection() {
  const { t } = useTranslation();
  const mode = useAppStore(
    (state) => state.settings.assistantPermissionMode
  );
  const setSettings = useAppStore((state) => state.setSettings);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            {t("assistant.permissionTitle")}
          </CardTitle>
          <CardDescription>
            {t("assistant.permissionDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="assistant-permission-mode">
                  {t("assistant.defaultMode")}
                </FieldLabel>
                <FieldDescription>
                  {t(`assistant.modes.${mode}Description`)}
                </FieldDescription>
              </FieldContent>
              <Select
                value={mode}
                onValueChange={(value) =>
                  setSettings({
                    assistantPermissionMode: value as AssistantPermissionMode,
                  })
                }
              >
                <SelectTrigger id="assistant-permission-mode" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="confirm-sensitive">
                      {t("assistant.modes.confirm-sensitive")}
                    </SelectItem>
                    <SelectItem value="read-only">
                      {t("assistant.modes.read-only")}
                    </SelectItem>
                    <SelectItem value="yolo">
                      {t("assistant.modes.yolo")}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>

          {mode === "yolo" && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>{t("assistant.yoloWarningTitle")}</AlertTitle>
              <AlertDescription>
                {t("assistant.yoloWarningDescription")}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-4" />
            {t("assistant.todoTitle")}
          </CardTitle>
          <CardDescription>{t("assistant.todoDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 text-sm">
            <Bot className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="leading-relaxed text-muted-foreground">
              {t("assistant.todoBehavior")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function AssistantSettingsPane() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-xl font-bold">
          {t("assistant.settingsTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("assistant.settingsDescription")}
        </p>
      </div>
      <AssistantPermissionsSection />
    </div>
  );
}
