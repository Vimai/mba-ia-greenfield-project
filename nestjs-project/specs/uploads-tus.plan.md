---
subproject: backend
runner: jest+supertest
scope: phase-03-upload-processing
si: SI-03.5
target_file: nestjs-project/test/uploads-tus.e2e-spec.ts
---

# Endpoint tus de upload resumável — Test Plan

## Application Overview

O endpoint `/uploads/tus` implementa o protocolo tus 1.0 dentro do NestJS (`@tus/server` + `@tus/s3-store`) para upload resumável de vídeos de até 10 GiB direto para o object storage (MinIO), em caminho de bytes memory-flat. No handshake de criação (`POST`) o vídeo é pré-cadastrado como rascunho (`status: draft`, `processing_status: uploading`) com `public_id` único (nanoid ~11 chars); no último byte recebido (`PATCH` final) o vídeo transiciona para `processing_status: processing` e um job `video-processing` é enfileirado transacionalmente no pg-boss.

## Test Scenarios

### 1. Upload creation

**Setup:** `beforeEach` truncate test DB (tabelas `videos`, `channels`, `users` + schema `pgboss`); bootstrap do módulo de teste NestJS (`Test.createTestingModule(...).compile()`) com app completa; criar usuário autenticado (signup + login helpers da Fase 02) e obter access token; MinIO da stack de teste acessível.

#### 1.1. create-upload-authenticated

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-07-07T23:20:35Z

**Steps:**
  1. POST /uploads/tus com `Authorization: Bearer {token}`, `Tus-Resumable: 1.0.0`, `Upload-Length` pequeno (ex.: 1 KiB) e `Upload-Metadata` com `filename` codificado em base64
    - expect: status 201
    - expect: header `Location` presente apontando para o upload criado
  2. Consultar a tabela `videos` pelo registro recém-criado
    - expect: 1 registro com `status = 'draft'`, `processing_status = 'uploading'`
    - expect: `public_id` preenchido com ~11 caracteres URL-safe
    - expect: `storage_key` seguindo o padrão `videos/{public_id}`

#### 1.2. create-upload-unauthenticated

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-07-07T23:20:35Z

**Steps:**
  1. POST /uploads/tus sem header `Authorization`, com `Tus-Resumable: 1.0.0` e `Upload-Length` válido
    - expect: status 401
    - expect: nenhum registro novo na tabela `videos`

#### 1.3. create-upload-too-large

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-07-07T23:20:35Z

**Steps:**
  1. POST /uploads/tus autenticado com `Upload-Length` acima de 10 GiB (ex.: `10737418241`)
    - expect: status 413
    - expect: nenhum registro novo na tabela `videos`

### 2. Upload data transfer

**Setup:** mesmo bootstrap do grupo 1; helper que cria um upload via POST e retorna a URL do `Location` para os PATCHes subsequentes; fixture de bytes pequena (ex.: 1 KiB) como payload.

#### 2.1. finalize-upload-enqueues-processing

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-07-07T23:20:35Z

**Steps:**
  1. Criar upload autenticado (POST) com `Upload-Length` igual ao tamanho da fixture
    - expect: status 201 com `Location`
  2. PATCH na URL do upload com `Upload-Offset: 0`, `Content-Type: application/offset+octet-stream` e o corpo completo da fixture
    - expect: status 204 com `Upload-Offset` final igual ao `Upload-Length`
  3. Consultar o registro `videos` e a fila `video-processing` no schema do pg-boss
    - expect: `processing_status = 'processing'` e `size_bytes` igual ao tamanho da fixture
    - expect: exatamente 1 job `video-processing` com payload `{ videoId }` do vídeo criado

#### 2.2. resume-interrupted-upload

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-07-07T23:20:35Z

**Steps:**
  1. Criar upload autenticado (POST) com `Upload-Length` igual ao tamanho total da fixture
    - expect: status 201 com `Location`
  2. PATCH parcial enviando apenas a primeira metade dos bytes
    - expect: status 204 com `Upload-Offset` igual à metade enviada
  3. HEAD na URL do upload com `Tus-Resumable: 1.0.0`
    - expect: status 200 com `Upload-Offset` refletindo os bytes já recebidos
  4. PATCH final a partir do offset corrente com a segunda metade dos bytes
    - expect: status 204 com `Upload-Offset` final igual ao `Upload-Length`
    - expect: vídeo transiciona para `processing_status = 'processing'` (upload completo)
