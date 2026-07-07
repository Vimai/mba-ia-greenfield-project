---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing
si: SI-03.8
target_file: nestjs-project/test/videos-delivery.e2e-spec.ts
---

# Endpoints de status, streaming e download — Test Plan

## Application Overview

Três endpoints REST sobre o recurso `videos`: `GET /videos/:publicId/status` (polling do status de processamento — apenas o dono do vídeo), `GET /videos/:publicId/stream-url` e `GET /videos/:publicId/download-url` (emissão de presigned GET URLs direto do object storage, públicos, condicionados a `processing_status: ready`; download com `Content-Disposition: attachment` embutido na assinatura). Erros seguem o envelope herdado `{ statusCode, error, message }` com códigos de domínio `VIDEO_NOT_FOUND`, `VIDEO_NOT_OWNED`, `VIDEO_NOT_READY`.

## Test Scenarios

### 1. Processing status

**Setup:** `beforeEach` truncate test DB; bootstrap do módulo de teste NestJS; dois usuários autenticados (dono e não-dono) com canais; seed de um `Video` do canal do dono via repositório (estado controlado por cenário); MinIO da stack de teste com objeto de fixture no bucket `videos`.

#### 1.1. status-owner-success

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-07T23:20:35Z

**Steps:**
  1. Seed de vídeo `ready` (com `duration_seconds`, `width`, `height`, `thumbnail_key` preenchidos) no canal do dono
  2. GET /videos/{publicId}/status com `Authorization: Bearer {token do dono}`
    - expect: status 200
    - expect: body com `publicId`, `title`, `processingStatus: "ready"`, `durationSeconds`, `width`, `height` numéricos
    - expect: `thumbnailUrl` string não-vazia (presigned GET) quando `thumbnail_key` existe

#### 1.2. status-not-owner-forbidden

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-07T23:20:35Z

**Steps:**
  1. GET /videos/{publicId}/status com `Authorization: Bearer {token do não-dono}`
    - expect: status 403
    - expect: body com `errorCode` do envelope: `error: "VIDEO_NOT_OWNED"`

#### 1.3. status-unauthenticated

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-07T23:20:35Z

**Steps:**
  1. GET /videos/{publicId}/status sem header `Authorization`
    - expect: status 401

### 2. Streaming and download delivery

**Setup:** mesmo bootstrap do grupo 1; seed de vídeo `ready` com objeto real no bucket `videos` do MinIO de teste (fixture pequena), e de um segundo vídeo em `processing_status: processing`.

#### 2.1. stream-url-ready-anonymous

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-07T23:20:35Z

**Steps:**
  1. GET /videos/{publicId}/stream-url sem autenticação, para o vídeo `ready`
    - expect: status 200
    - expect: body com `url` (string) e `expiresInSeconds` (number)
  2. GET na `url` retornada (host público do MinIO)
    - expect: status 200 (ou 206 com header `Range`) com os bytes da fixture

#### 2.2. stream-url-not-ready-conflict

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-07T23:20:35Z

**Steps:**
  1. GET /videos/{publicId}/stream-url para o vídeo em `processing_status: processing`
    - expect: status 409
    - expect: `error: "VIDEO_NOT_READY"` no envelope

#### 2.3. download-url-attachment-disposition

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-07-07T23:20:35Z

**Steps:**
  1. GET /videos/{publicId}/download-url para o vídeo `ready`
    - expect: status 200 com `url` contendo `response-content-disposition` na query string assinada
  2. GET na `url` retornada
    - expect: status 200 com header `Content-Disposition` iniciando com `attachment`

### 3. Not found

**Setup:** mesmo bootstrap; nenhum vídeo com o `publicId` consultado.

#### 3.1. unknown-public-id-not-found

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-07-07T23:20:35Z

**Steps:**
  1. GET /videos/{publicId inexistente}/status com token válido
    - expect: status 404 com `error: "VIDEO_NOT_FOUND"`
  2. GET /videos/{publicId inexistente}/stream-url
    - expect: status 404 com `error: "VIDEO_NOT_FOUND"`
  3. GET /videos/{publicId inexistente}/download-url
    - expect: status 404 com `error: "VIDEO_NOT_FOUND"`
