/**
 * Ported from https://github.com/davidteather/TikTok-Api
 * 
 * Mock inbrowser functions to trick tiktok into thinking
 * this is a real browser 
 */
import { Page } from "puppeteer"

const console_debug = async (page: Page) => {
  await page.evaluateOnNewDocument(
    () => {
      window.console.debug = () => {
        return null
      }
    }
  )
}


const iframe_content_window = async (page: Page) => {
  await page.evaluateOnNewDocument(
    () => {
      try {
        // Adds a contentWindow proxy to the provided iframe element
        const addContentWindowProxy = (iframe: any) => {
          const contentWindowProxy = {
            get(target: any, key: any) {
              // Now to the interesting part:
              // We actually make this thing behave like a regular iframe window,
              // by intercepting calls to e.g. `.self` and redirect it to the correct thing. :)
              // That makes it possible for these assertions to be correct:
              // iframe.contentWindow.self === window.top // must be false
              if (key === 'self') {
                return this
              }
              // iframe.contentWindow.frameElement === iframe // must be true
              if (key === 'frameElement') {
                return iframe
              }
              return Reflect.get(target, key)
            }
          }
          if (!iframe.contentWindow) {
            const proxy = new Proxy(window, contentWindowProxy)
            Object.defineProperty(iframe, 'contentWindow', {
              get() {
                return proxy
              },
              set(newValue) {
                return newValue // contentWindow is immutable
              },
              enumerable: true,
              configurable: false
            })
          }
        }
        // Handles iframe element creation, augments `srcdoc` property so we can intercept further
        const handleIframeCreation = (target: any, thisArg: any, args: any) => {
          const iframe = target.apply(thisArg, args)
          // We need to keep the originals around
          const _iframe = iframe
          const _srcdoc = _iframe.srcdoc
          // Add hook for the srcdoc property
          // We need to be very surgical here to not break other iframes by accident
          Object.defineProperty(iframe, 'srcdoc', {
            configurable: true, // Important, so we can reset this later
            get: function () {
              return _iframe.srcdoc
            },
            set: function (newValue) {
              addContentWindowProxy(this)
              // Reset property, the hook is only needed once
              Object.defineProperty(iframe, 'srcdoc', {
                configurable: false,
                writable: false,
                value: _srcdoc
              })
              _iframe.srcdoc = newValue
            }
          })
          return iframe
        }
        // Adds a hook to intercept iframe creation events
        const addIframeCreationSniffer = () => {
          /* global document */
          const createElement = {
            // Make toString() native
            get(target: any, key: any) {
              return Reflect.get(target, key)
            },
            apply: function (target: any, thisArg: any, args: any) {
              const isIframe =
                args && args.length && `${args[0]}`.toLowerCase() === 'iframe'
              if (!isIframe) {
                // Everything as usual
                return target.apply(thisArg, args)
              } else {
                return handleIframeCreation(target, thisArg, args)
              }
            }
          }
          // All this just due to iframes with srcdoc bug
          document.createElement = new Proxy(
            document.createElement,
            createElement
          )
        }
        // Let's go
        addIframeCreationSniffer()
      } catch (err) {
        // console.warn(err)
      }
    }
  )
}

const media_codecs = async (page: Page) => {
  await page.evaluateOnNewDocument(
    () => {
      try {
        /**
         * Input might look funky, we need to normalize it so e.g. whitespace isn't an issue for our spoofing.
         *
         * @example
         * video/webm; codecs="vp8, vorbis"
         * video/mp4; codecs="avc1.42E01E"
         * audio/x-m4a;
         * audio/ogg; codecs="vorbis"
         * @param {String} arg
         */
        const parseInput = (arg: string) => {
          const [mime, codecStr] = arg.trim().split(';')
          let codecs: string[] = []
          if (codecStr && codecStr.includes('codecs="')) {
            codecs = codecStr
              .trim()
              .replace(`codecs="`, '')
              .replace(`"`, '')
              .trim()
              .split(',')
              .filter(x => !!x)
              .map(x => x.trim())
          }
          return { mime, codecStr, codecs }
        }
        /* global HTMLMediaElement */
        const canPlayType = {
          // Make toString() native
          get(target: any, key: any) {
            // Mitigate Chromium bug (#130)
            if (typeof target[key] === 'function') {
              return target[key].bind(target)
            }
            return Reflect.get(target, key)
          },
          // Intercept certain requests
          apply: function (target: any, ctx: any, args: any) {
            if (!args || !args.length) {
              return target.apply(ctx, args)
            }
            const { mime, codecs } = parseInput(args[0])
            // This specific mp4 codec is missing in Chromium
            if (mime === 'video/mp4') {
              if (codecs.includes('avc1.42E01E')) {
                return 'probably'
              }
            }
            // This mimetype is only supported if no codecs are specified
            if (mime === 'audio/x-m4a' && !codecs.length) {
              return 'maybe'
            }
            // This mimetype is only supported if no codecs are specified
            if (mime === 'audio/aac' && !codecs.length) {
              return 'probably'
            }
            // Everything else as usual
            return target.apply(ctx, args)
          }
        }
        HTMLMediaElement.prototype.canPlayType = new Proxy(
          HTMLMediaElement.prototype.canPlayType,
          canPlayType
        )
      } catch (err) { }
    }

  )
}

const navigator_languages = async (page: Page) => {
  await page.evaluateOnNewDocument(
    () => {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      })

    })
}

const navigator_permissions = async (page: Page) => {
  await page.evaluateOnNewDocument(
    `
() => {
    const originalQuery = window.navigator.permissions.query
    window.navigator.permissions.__proto__.query = (parameters) =>
        parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters)
    const oldCall = Function.prototype.call
    function call () {
        return oldCall.apply(this, arguments)
    }
    Function.prototype.call = call
    const nativeToStringFunctionString = Error.toString().replace(
        /Error/g,
        'toString'
    )
    const oldToString = Function.prototype.toString
    function functionToString () {
        if (this === window.navigator.permissions.query) {
            return 'function query() { [native code] }'
        }
        if (this === functionToString) {
            return nativeToStringFunctionString
        }
        return oldCall.call(oldToString, this)
    }
    Function.prototype.toString = functionToString
}`
  )
}

const navigator_plugins = async (page: Page) => {
  await page.evaluateOnNewDocument(

    () => {
      function mockPluginsAndMimeTypes() {
        const makeFnsNative = (fns: any[] = []) => {
          const oldCall = Function.prototype.call
          function call(this: any) {
            return oldCall.apply(this, (arguments as any))
          }
          Function.prototype.call = call
          const nativeToStringFunctionString = Error.toString().replace(
            /Error/g,
            'toString'
          )
          const oldToString = Function.prototype.toString
          function functionToString(this: any) {
            for (const fn of fns) {
              if (this === fn.ref) {
                return `function ${fn.name}() { [native code] `
              }
            }
            if (this === functionToString) {
              return nativeToStringFunctionString
            }
            return oldCall.call(oldToString, this)
          }
          Function.prototype.toString = functionToString
        }
        const mockedFns: any[] = []
        const fakeData = {
          mimeTypes: [
            {
              type: 'application/pdf',
              suffixes: 'pdf',
              description: '',
              __pluginName: 'Chrome PDF Viewer'
            },
            {
              type: 'application/x-google-chrome-pdf',
              suffixes: 'pdf',
              description: 'Portable Document Format',
              __pluginName: 'Chrome PDF Plugin'
            },
            {
              type: 'application/x-nacl',
              suffixes: '',
              description: 'Native Client Executable',
              enabledPlugin: Plugin,
              __pluginName: 'Native Client'
            },
            {
              type: 'application/x-pnacl',
              suffixes: '',
              description: 'Portable Native Client Executable',
              __pluginName: 'Native Client'
            }
          ],
          plugins: [
            {
              name: 'Chrome PDF Plugin',
              filename: 'internal-pdf-viewer',
              description: 'Portable Document Format'
            },
            {
              name: 'Chrome PDF Viewer',
              filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
              description: ''
            },
            {
              name: 'Native Client',
              filename: 'internal-nacl-plugin',
              description: ''
            }
          ],
          fns: {
            namedItem: (instanceName: string) => {
              const fn = function (this: any, name: string) {
                if (!arguments.length) {
                  throw new TypeError(
                    `Failed to execute 'namedItem' on '${instanceName}': 1 argument required, but only 0 present.`
                  )
                }
                return this[name] || null
              }
              mockedFns.push({ ref: fn, name: 'namedItem' })
              return fn
            },
            item: (instanceName: string) => {
              const fn = function (this: any, index: number) {
                if (!arguments.length) {
                  throw new TypeError(
                    `Failed to execute 'namedItem' on '${instanceName}': 1 argument required, but only 0 present.`
                  )
                }
                return this[index] || null
              }
              mockedFns.push({ ref: fn, name: 'item' })
              return fn
            },
            refresh: () => {
              const fn = function () {
                return undefined
              }
              mockedFns.push({ ref: fn, name: 'refresh' })
              return fn
            }
          }
        }
        const getSubset = (keys: any[], obj: any) =>
          keys.reduce((a, c) => ({ ...a, [c]: obj[c] }), {})
        function generateMimeTypeArray() {
          const arr: any = fakeData.mimeTypes
            .map(obj => getSubset(['type', 'suffixes', 'description'], obj))
            .map(obj => Object.setPrototypeOf(obj, MimeType.prototype))
          arr.forEach((obj: any) => {
            arr[obj.type] = obj
          })
          arr.namedItem = fakeData.fns.namedItem('MimeTypeArray')
          arr.item = fakeData.fns.item('MimeTypeArray')
          return Object.setPrototypeOf(arr, MimeTypeArray.prototype)
        }
        const mimeTypeArray = generateMimeTypeArray()
        Object.defineProperty(navigator, 'mimeTypes', {
          get: () => mimeTypeArray
        })
        function generatePluginArray() {
          const arr: any = fakeData.plugins
            .map(obj => getSubset(['name', 'filename', 'description'], obj))
            .map(obj => {
              const mimes = fakeData.mimeTypes.filter(
                m => m.__pluginName === obj.name
              )
              mimes.forEach((mime, index) => {
                (navigator.mimeTypes[mime.type as any].enabledPlugin as any) = obj
                obj[mime.type] = navigator.mimeTypes[mime.type as any]
                obj[index] = navigator.mimeTypes[mime.type as any]
              })
              obj.length = mimes.length
              return obj
            })
            .map(obj => {
              obj.namedItem = fakeData.fns.namedItem('Plugin')
              obj.item = fakeData.fns.item('Plugin')
              return obj
            })
            .map(obj => Object.setPrototypeOf(obj, Plugin.prototype))
          arr.forEach((obj: any) => {
            arr[obj.name] = obj
          })
          arr.namedItem = fakeData.fns.namedItem('PluginArray')
          arr.item = fakeData.fns.item('PluginArray')
          arr.refresh = fakeData.fns.refresh()
          return Object.setPrototypeOf(arr, PluginArray.prototype)
        }
        const pluginArray = generatePluginArray()
        Object.defineProperty(navigator, 'plugins', {
          get: () => pluginArray
        })
        makeFnsNative(mockedFns)
      }
      try {
        const isPluginArray = navigator.plugins instanceof PluginArray
        const hasPlugins = isPluginArray && navigator.plugins.length > 0
        if (isPluginArray && hasPlugins) {
          return
        }
        mockPluginsAndMimeTypes()
      } catch (err) { }
    })
}


const navigator_webdriver = async (page: Page) => {
  await page.evaluateOnNewDocument(

    () => {
      Object.defineProperty(window, 'navigator', {
        value: new Proxy(navigator, {
          has: (target, key) => (key === 'webdriver' ? false : key in target),
          get: (target, key) =>
            key === 'webdriver'
              ? undefined
              : typeof target[key as keyof typeof target] === 'function'
                ? (target[key as keyof typeof target] as any).bind(target)
                : target[key as keyof typeof target]
        })
      })
    }
  )
}


const user_agent = async (page: Page) => {
  let ua = await page.browser().userAgent();
  ua = ua.replace("HeadlessChrome", "Chrome");
  ua = ua.replace(/\(([^)]+)\)/, '(Windows NT 10.0; Win64; x64)');

  await page.setUserAgent(ua)
}

const webgl_vendor = async (page: Page) => {
  await page.evaluateOnNewDocument(
    () => {
      try {
        const getParameter = WebGLRenderingContext.prototype.getParameter
        WebGLRenderingContext.prototype.getParameter = function (parameter) {
          if (parameter === 37445) {
            return 'Intel Inc.'
          }
          if (parameter === 37446) {
            return 'Intel Iris OpenGL Engine'
          }
          return getParameter.apply(this, [parameter])
        }
      } catch (err) { }
    }
  )
}

const window_outerdimensions = async (page: Page) => {
  await page.evaluateOnNewDocument(
    () => {
      try {
        if (window.outerWidth && window.outerHeight) {
          return
        }
        const windowFrame = 85;
        (window as any).outerWidth = window.innerWidth;
        (window as any).outerHeight = window.innerHeight + windowFrame;
      } catch (err) { }
    }
  )
}

export default async (page: Page) => {
  await console_debug(page)
  await iframe_content_window(page)
  await navigator_permissions(page)
  await navigator_plugins(page)
  await navigator_webdriver(page)
  await user_agent(page)
  await webgl_vendor(page)
  await window_outerdimensions(page);
  await media_codecs(page);
}