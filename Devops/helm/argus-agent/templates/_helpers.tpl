{{/*
Expand the name of the chart.
*/}}
{{- define "argus-agent.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "argus-agent.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Selector labels (stable — used in matchLabels and Service selectors).
*/}}
{{- define "argus-agent.selectorLabels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
