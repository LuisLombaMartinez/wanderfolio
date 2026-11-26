// CloudFront Function (cloudfront-js-2.0), viewer request, default behaviour only.
// Client routes (no file extension in the last segment) get the SPA's index.html;
// real files pass through. /api/* and /media/* never reach this function.
function handler(event) {
  var request = event.request
  var lastSegment = request.uri.substring(request.uri.lastIndexOf('/') + 1)
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html'
  }
  return request
}
