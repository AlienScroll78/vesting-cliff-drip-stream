{{/*
Expand the name of the chart.
*/}}
{{- define "vesting-backend.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (e.g. by DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "vesting-backend.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "vesting-backend.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "vesting-backend.labels" -}}
helm.sh/chart: {{ include "vesting-backend.chart" . }}
{{ include "vesting-backend.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels used by Deployment and Service.
*/}}
{{- define "vesting-backend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "vesting-backend.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Name of the ServiceAccount to use.
*/}}
{{- define "vesting-backend.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "vesting-backend.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Name of the target Kubernetes Secret created by ExternalSecret.
Defaults to <fullname>-secrets.
*/}}
{{- define "vesting-backend.externalSecretTargetName" -}}
{{- if .Values.externalSecret.targetSecretName }}
{{- .Values.externalSecret.targetSecretName }}
{{- else }}
{{- printf "%s-secrets" (include "vesting-backend.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Image reference: repository:tag (tag defaults to .Chart.AppVersion).
*/}}
{{- define "vesting-backend.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion }}
{{- printf "%s:%s" .Values.image.repository $tag }}
{{- end }}
