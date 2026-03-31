function getMessageFromResponseData(responseData, fallbackMessage) {
  if (typeof responseData?.error === 'string' && responseData.error.trim()) {
    return responseData.error;
  }

  const firstValidationMessage = responseData?.errors?.find(
    (entry) => typeof entry?.msg === 'string' && entry.msg.trim()
  )?.msg;

  return firstValidationMessage || fallbackMessage;
}

async function parseBlobResponseData(blob) {
  if (typeof Blob === 'undefined' || !(blob instanceof Blob)) {
    return null;
  }

  const text = (await blob.text()).trim();
  if (!text) {
    return null;
  }

  if (blob.type?.includes('application/json') || text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }

  return { error: text };
}

export function getApiErrorMessage(error, fallbackMessage) {
  return getMessageFromResponseData(error?.response?.data, fallbackMessage);
}

export async function getBlobApiErrorMessage(error, fallbackMessage) {
  const responseData = error?.response?.data;

  const parsedBlobData = await parseBlobResponseData(responseData);
  if (parsedBlobData) {
    return getMessageFromResponseData(parsedBlobData, fallbackMessage);
  }

  return getApiErrorMessage(error, fallbackMessage);
}
