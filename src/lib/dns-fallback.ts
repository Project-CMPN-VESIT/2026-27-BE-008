import dns from "dns";

const globalForDns = globalThis as typeof globalThis & { _dnsFallbackInitialized?: boolean };

if (!globalForDns._dnsFallbackInitialized) {
  globalForDns._dnsFallbackInitialized = true;

  const originalLookup = dns.lookup;
  const resolver = new dns.Resolver();
  // Use public DNS resolvers when local ISP DNS refuses or fails to resolve cloud endpoints
  resolver.setServers(["8.8.8.8", "1.1.1.1"]);

  dns.lookup = function (hostname: any, options: any, callback: any) {
    let cb = callback;
    let opts = options;
    if (typeof options === "function") {
      cb = options;
      opts = {};
    } else if (typeof options === "number") {
      opts = { family: options };
    }

    originalLookup(hostname, opts, (err, address, family) => {
      if (!err) return cb(null, address, family);

      // On DNS failure (e.g. ENOTFOUND / RCODE_REFUSED from ISP router), resolve via fallback DNS
      resolver.resolve4(hostname, (err2, addresses) => {
        if (err2 || !addresses || addresses.length === 0) {
          return cb(err);
        }
        if (opts && opts.all) {
          return cb(
            null,
            addresses.map((a) => ({ address: a, family: 4 }))
          );
        }
        return cb(null, addresses[0], 4);
      });
    });
  } as any;
}

