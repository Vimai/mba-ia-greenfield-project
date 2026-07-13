import * as tus from "tus-js-client";

export interface UploadCallbacks {
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
  onSuccess?: (payload: { lastResponse: tus.HttpResponse }) => void;
  onError?: (error: Error | tus.DetailedError) => void;
}

// Setup — fundação FE-runtime; consumida pela UI de upload de fase futura
export async function startUpload(
  file: File,
  callbacks: UploadCallbacks = {}
): Promise<tus.Upload> {
  const upload = new tus.Upload(file, {
    endpoint: "/api/uploads/tus",                 // rota BFF proxy (upload-processing/TD-02) — nunca o Nest direto
    retryDelays: [0, 3000, 5000, 10000, 20000],   // retry automático em erros transitórios
    metadata: { filename: file.name, filetype: file.type },
    onProgress: callbacks.onProgress,
    onSuccess: callbacks.onSuccess,
    onError: callbacks.onError,
  });
  const previousUploads = await upload.findPreviousUploads();
  if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
  upload.start();

  return upload;
}
