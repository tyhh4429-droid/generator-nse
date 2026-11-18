import characterNumbers from 'hershey/src/characterNumbers.js'
import rowmansData from 'hershey/src/rowmans.js'

type CharacterDescriptor = {
    left: number
    right: number
    paths: [number, number][][]
}

const origin = 'R'.charCodeAt(0)

const parseDescriptor = (descriptor: string) => {
    const number = Number.parseInt(descriptor.slice(0, 5), 10)
    const left = descriptor.charCodeAt(8) - origin
    const right = descriptor.charCodeAt(9) - origin
    const vertexCount = Number.parseInt(descriptor.slice(5, 8), 10) - 1
    const paths: [number, number][][] = [[]]

    for (let i = 0; i < vertexCount; i++) {
        const x = descriptor.charCodeAt(10 + i * 2) - origin
        const y = descriptor.charCodeAt(11 + i * 2) - origin

        if (x === -50 && y === 0) {
            paths.push([])
        } else {
            const path = paths.at(-1)
            if (path) path.push([x, -y])
        }
    }

    return [number, { left, right, paths }] as const
}

const descriptors = new Map<number, CharacterDescriptor>(
    atob(rowmansData)
        .split('\n')
        .filter((line) => line.trim())
        .map(parseDescriptor),
)

export const characterToPaths = (character: string) => {
    const number = characterNumbers[character] ?? characterNumbers[' ']
    if (number === undefined) throw new Error('Missing Hershey space glyph mapping.')

    const descriptor = descriptors.get(number)
    if (!descriptor) throw new Error(`Missing Hershey glyph descriptor: ${number}`)

    return {
        width: descriptor.right - descriptor.left,
        paths: descriptor.paths.map((path) =>
            path.map(([x, y]) => [x - descriptor.left, y] as [number, number]),
        ),
    }
}
