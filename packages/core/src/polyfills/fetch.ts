export {};

// fetch polyfill. Delegates to the host network stack via `__fetch_start`,
// which resolves/rejects the promise from a tokio worker. Returns a
// Response-like object with text()/json() accessors.

let nextFetchId = 1;
(globalThis as any).fetch = function (url: string, init?: any) {
  const id = nextFetchId++;
  const method = init && init.method ? String(init.method) : "GET";
  const headers = init && init.headers ? JSON.stringify(init.headers) : "{}";
  const body = init && init.body ? String(init.body) : null;
  return new Promise(function (resolve, reject) {
    __fetch_start(id, String(url), method, headers, body, resolve, reject);
  }).then(function (res: any) {
    if (res.error) throw new Error(res.error);
    return {
      status: res.status,
      headers: res.headers,
      text: function () {
        return Promise.resolve(res.body);
      },
      json: function () {
        return Promise.resolve(JSON.parse(res.body));
      },
    };
  });
};
