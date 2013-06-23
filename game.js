ig.module(
    'plugins.box2d.game'
)
.requires(
    'plugins.box2d.lib',
    'impact.game'
)
.defines(function(){

    ig.Box2DGame = ig.Game.extend({

        allowSleep: true,
        collisionRects: [],
        debugCollisionRects: false,

        checkEntities: function() {
            for( var e = 0; e < this.entities.length; e++ ) {
                var entityA = this.entities[e];
                // Preserve Impact's entity checks.
                for(var id in entityA.checkQueue) {
                    var entityB = entityA.checkQueue[id].entity;
                    if(entityA.checkQueue[id].contactCount > 0) {
                        entityA.check(entityB);
                    }
                }
                // Preserve Impact's collideWith calls.
                for(var id in entityA.collideQueue) {
                    var entityB = entityA.collideQueue[id].entity;
                    var axis = entityA.collideQueue[id].axis;
                    entityA.collideWith(entityB, axis);
                    delete entityA.collideQueue[id];
                }
            }
        },

        loadLevel: function(data) {

            // Find the collision layer and create the box2d world from it
            for (var i = 0; i < data.layer.length; i++) {
                var ld = data.layer[i];
                if (ld.name == 'collision') {
                    ig.world = this.createWorldFromMap(ld.data, ld.width, ld.height, ld.tilesize);
                    break;
                }
            }

            this.parent(data);

            this.setupContactListener();
        },

        setupContactListener: function() {
            var listener = new Box2D.Dynamics.b2ContactListener();
            listener.BeginContact = function(contact) {
                var a = contact.GetFixtureA().GetBody().entity;
                var b = contact.GetFixtureB().GetBody().entity;
                if(a && b) {
                    if (a.checkAgainst & b.type) {
                        if(typeof a.checkQueue[b.id] === 'undefined') {
                            a.checkQueue[b.id] = { contactCount: 0, entity: b };
                        }
                        a.checkQueue[b.id].contactCount++;
                    }
                    if (b.checkAgainst & a.type) {
                        if(typeof b.checkQueue[a.id] === 'undefined') {
                            b.checkQueue[a.id] = { contactCount: 0, entity: a };
                        }
                        b.checkQueue[a.id].contactCount++;
                    }
                    var normal = contact.GetManifold().m_localPlaneNormal;
                    var axis = (Math.abs(normal.y) > Math.abs(normal.x)) ? 'y' : 'x';
                    a.collideQueue[b.id] = { entity: b, axis: axis };
                    b.collideQueue[a.id] = { entity: a, axis: axis };
                }
            };
            listener.EndContact = function(contact) {
                var a = contact.GetFixtureA().GetBody().entity;
                var b = contact.GetFixtureB().GetBody().entity;
                if(a && b) {
                    if (a.checkAgainst & b.type) {
                        if(typeof a.checkQueue[b.id] === 'undefined') {
                            a.checkQueue[b.id] = { contactCount: 0, entity: b };
                        }
                        a.checkQueue[b.id].contactCount--;
                    }
                    if (b.checkAgainst & a.type) {
                        if(typeof b.checkQueue[a.id] === 'undefined') {
                            b.checkQueue[a.id] = { contactCount: 0, entity: a };
                        }
                        b.checkQueue[a.id].contactCount--;
                    }
                }
            };
            ig.world.SetContactListener(listener);
        },

        createWorldFromMap: function(origData, width, height, tilesize) {

            // Gravity is applied to entities individually.
            var gravity = new Box2D.Common.Math.b2Vec2(0, 0);
            var world = new Box2D.Dynamics.b2World(gravity, this.allowSleep);

            // We need to delete those tiles that we already processed. The original
            // map data is copied, so we don't destroy the original.
            var data = ig.copy(origData);

            // Get all the Collision Rects from the map
            this.collisionRects = [];
            for (var y = 0; y < height; y++) {
                for (var x = 0; x < width; x++) {
                    // If this tile is solid, find the rect of solid tiles starting
                    // with this one
                    if (data[y][x]) {
                        var r = this._extractRectFromMap(data, width, height, x, y);
                        this.collisionRects.push(r);
                    }
                }
            }

            // Go through all rects we gathered and create Box2D objects from them
            for (var i = 0; i < this.collisionRects.length; i++) {
                var rect = this.collisionRects[i];

                var bodyDef = new Box2D.Dynamics.b2BodyDef();
                bodyDef.position.Set(
                    rect.x * tilesize * Box2D.SCALE + rect.width * tilesize / 2 * Box2D.SCALE,
                    rect.y * tilesize * Box2D.SCALE + rect.height * tilesize / 2 * Box2D.SCALE);

                var body = world.CreateBody(bodyDef);
                var shape = new Box2D.Collision.Shapes.b2PolygonShape();
                shape.SetAsBox(
                    rect.width * tilesize / 2 * Box2D.SCALE,
                    rect.height * tilesize / 2 * Box2D.SCALE);
                body.CreateFixture2(shape);
            }

            return world;
        },

        _extractRectFromMap: function(data, width, height, x, y) {
            var rect = {
                x: x,
                y: y,
                width: 1,
                height: 1
            };

            // Find the width of this rect
            for (var wx = x + 1; wx < width && data[y][wx]; wx++) {
                rect.width++;
                data[y][wx] = 0; // unset tile
            }

            // Check if the next row with the same width is also completely solid
            for (var wy = y + 1; wy < height; wy++) {
                var rowWidth = 0;
                for (wx = x; wx < x + rect.width && data[wy][wx]; wx++) {
                    rowWidth++;
                }

                // Same width as the rect? -> All tiles are solid; increase height
                // of this rect
                if (rowWidth == rect.width) {
                    rect.height++;

                    // Unset tile row from the map
                    for (wx = x; wx < x + rect.width; wx++) {
                        data[wy][wx] = 0;
                    }
                } else {
                    return rect;
                }
            }
            return rect;
        },

        update: function() {
            ig.world.Step(ig.system.tick, 5, 5);
            ig.world.ClearForces();
            this.parent();
        },

        draw: function() {
            this.parent();

            if (this.debugCollisionRects) {
                // Draw outlines of all collision rects
                var ts = this.collisionMap.tilesize;
                for (var i = 0; i < this.collisionRects.length; i++) {
                    var rect = this.collisionRects[i];
                    ig.system.context.strokeStyle = '#00ff00';
                    ig.system.context.strokeRect(
                        ig.system.getDrawPos(rect.x * ts - this.screen.x),
                        ig.system.getDrawPos(rect.y * ts - this.screen.y),
                        ig.system.getDrawPos(rect.width * ts),
                        ig.system.getDrawPos(rect.height * ts));
                }
            }
        },

        /* Builds the quite possibly useful res object.
         * AUTHOR: quidmonkey
         * URL:    http://impactjs.com/forums/code/box2d-collision-plugin/page/2#post22254 */
        buildResObject: function(contact) {
            var a = contact.entityA;
            var b = contact.entityB;
            var entity = !a ? b : a;
            var res = {
                collision: {x: false, y: false, slope: false},
                pos: null,
                slopeAngle: null,
                tile: null
            };
            res.pos = {
                x: (entity.pos.x / Box2D.SCALE - entity.size.x / 2),
                y: (entity.pos.y / Box2D.SCALE - entity.size.y / 2)
            };
            if (Math.abs(contact.normal.x) === 1) {
                res.pos.x += entity.vel.x > 0 ? entity.size.x : 0;
                res.collision.x = true;
            } else if (contact.normal.x) {
                res.collision.slope = true;
                res.slopeAngle = Math.atan2(contact.normal.x, -contact.normal.y); // atan of normal orthogonal
            }
            if (Math.abs(contact.normal.y) === 1) {
                res.pos.y += entity.vel.y > 0 ? entity.size.y : 0;
                res.collision.y = true;
            } else if (contact.normal.y) {
                res.collision.slope = true;
                res.slopeAngle = Math.atan2(contact.normal.x, -contact.normal.y); // atan of normal orthogonal
            }
            res.tile = ig.game.collisionMap.getTile(res.pos.x, res.pos.y);
            return res;
        }

    });

});

