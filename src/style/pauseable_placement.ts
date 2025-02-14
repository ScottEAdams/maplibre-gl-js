import browser from '../util/browser';

import {Placement} from '../symbol/placement';

import type Transform from '../geo/transform';
import type StyleLayer from './style_layer';
import type SymbolStyleLayer from './style_layer/symbol_style_layer';
import type Tile from '../source/tile';
import type {BucketPart} from '../symbol/placement';
import Terrain from '../render/terrain';

class LayerPlacement {
    _sortAcrossTiles: boolean;
    _currentTileIndex: number;
    _currentPartIndex: number;
    _seenCrossTileIDs: {
        [k in string | number]: boolean;
    };
    _bucketParts: Array<BucketPart>;

    constructor(styleLayer: SymbolStyleLayer) {
        this._sortAcrossTiles = styleLayer.layout.get('symbol-z-order') !== 'viewport-y' &&
            !styleLayer.layout.get('symbol-sort-key').isConstant();

        this._currentTileIndex = 0;
        this._currentPartIndex = 0;
        this._seenCrossTileIDs = {};
        this._bucketParts = [];
    }

    continuePlacement(tiles: Array<Tile>, placement: Placement, showCollisionBoxes: boolean, styleLayer: StyleLayer, shouldPausePlacement: () => boolean) {

        const bucketParts = this._bucketParts;

        while (this._currentTileIndex < tiles.length) {
            const tile = tiles[this._currentTileIndex];
            placement.getBucketParts(bucketParts, styleLayer, tile, this._sortAcrossTiles);

            this._currentTileIndex++;
            if (shouldPausePlacement()) {
                return true;
            }
        }

        if (this._sortAcrossTiles) {
            this._sortAcrossTiles = false;
            bucketParts.sort((a, b) => (a.sortKey as any as number) - (b.sortKey as any as number));
        }

        while (this._currentPartIndex < bucketParts.length) {
            const bucketPart = bucketParts[this._currentPartIndex];
            placement.placeLayerBucketPart(bucketPart, this._seenCrossTileIDs, showCollisionBoxes);

            this._currentPartIndex++;
            if (shouldPausePlacement()) {
                return true;
            }
        }
        return false;
    }
}

class PauseablePlacement {
    placement: Placement;
    _done: boolean;
    _currentPlacementIndex: number;
    _forceFullPlacement: boolean;
    _showCollisionBoxes: boolean;
    _inProgressLayer: LayerPlacement;

    constructor(
        transform: Transform,
        terrain: Terrain,
        order: Array<string>,
        forceFullPlacement: boolean,
        showCollisionBoxes: boolean,
        fadeDuration: number,
        crossSourceCollisions: boolean,
        prevPlacement?: Placement
    ) {
        this.placement = new Placement(transform, terrain, fadeDuration, crossSourceCollisions, prevPlacement);
        this._currentPlacementIndex = order.length - 1;
        this._forceFullPlacement = forceFullPlacement;
        this._showCollisionBoxes = showCollisionBoxes;
        this._done = false;
    }

    isDone() {
        return this._done;
    }

    continuePlacement(
        order: Array<string>,
        layers: {[_: string]: StyleLayer},
        layerTiles: {[_: string]: Array<Tile>}
    ) {
        const startTime = browser.now();

        const shouldPausePlacement = () => {
            return this._forceFullPlacement ? false : (browser.now() - startTime) > 2;
        };

        while (this._currentPlacementIndex >= 0) {
            const layerId = order[this._currentPlacementIndex];
            const layer = layers[layerId];
            const placementZoom = this.placement.collisionIndex.transform.zoom;
            if (layer.type === 'symbol' &&
                (!layer.minzoom || layer.minzoom <= placementZoom) &&
                (!layer.maxzoom || layer.maxzoom > placementZoom)) {

                if (!this._inProgressLayer) {
                    this._inProgressLayer = new LayerPlacement(layer as any as SymbolStyleLayer);
                }

                const pausePlacement = this._inProgressLayer.continuePlacement(layerTiles[layer.source], this.placement, this._showCollisionBoxes, layer, shouldPausePlacement);

                if (pausePlacement) {
                    // We didn't finish placing all layers within 2ms,
                    // but we can keep rendering with a partial placement
                    // We'll resume here on the next frame
                    return;
                }

                delete this._inProgressLayer;
            }

            this._currentPlacementIndex--;
        }

        this._done = true;
    }

    commit(now: number) {
        this.placement.commit(now);
        return this.placement;
    }
}

export default PauseablePlacement;
