export const RE_IS_OBJ_STRING = /^{.+}$/
export const objectStringToArray = function(objString) {
  return objString
    .slice(1, -1)
    .split(',')
    .map(key => key.trim())
}

export function isNonEmptyString(item) {
  return item && 'string' === typeof item
}

export function isValidArrayArgs(array) {
  return (
    Array.isArray(array) &&
    array.length > 0 &&
    array.map(objectStringIsNotAllowed).every(isNonEmptyString)
  )
}

function objectStringIsNotAllowed(item) {
  if (RE_IS_OBJ_STRING.test(item)) {
    throw new Error(`Object string ${item} is not allowed in array argument`)
  }
  return item
}
