import { flatten, unnest, clone } from 'ramda';

const adapter = ( config ) => {
	return {
		normalizeResults(data){
			
			if(!data.hasOwnProperty('results')) return [];
			
			var results = [],
				fieldMappings = config.fieldMappings;

			data.results[0].hits.map( (doc, key) => {

				var obj = {};
				for(var p in fieldMappings){
					obj[p] = doc[fieldMappings[p]]
				}

				results.push(obj)
			})
				
			return results;
		},
		normalizeFacets(data){
			
			if(!data.hasOwnProperty('results')) return [];

			var facetFields = data.results[0].facets,
				multiSelectFields = data.results.slice(1);

			function checkMultiSelectName(name){
				for(var i = 0; i < multiSelectFields.length; i++){
					if(multiSelectFields[i].facets.hasOwnProperty(name)){
						return multiSelectFields[i].facets[name]
					}
				}

				if(facetFields.hasOwnProperty(name)){
					return facetFields[name];
				}
			}
			
			var _facets = config.facets.map( (facet) => {
				
				var name = facet.name, values = [];

				values = this.normalizeFacetCount(checkMultiSelectName(name));

				return {...facet, values: values};
				
			});

			return _facets;
		},
		normalizeFacetCount(arr){
			
			var output = [];

			for(var key in arr){
				output.push({
					name: key,
					count: arr[key]
				})
			}
			
			return output;
		},
		normalizeTotalResults(data){
			
			if(!data.hasOwnProperty('results')) return 0;

			return data.results[0].nbHits
			
		},
		normalizeSpellSuggestionsSolr5(data){

			if(!data.hasOwnProperty('spellcheck')) return [];

			if(!data.spellcheck.hasOwnProperty('collations')) return [];

			var {collations}  = data.spellcheck,
				i = collations.length,
				output = [];

			while(i >= 0){

				i--;

				var sg = collations[i];

				if(sg instanceof Object){

					output.push({
						term: sg.collationQuery,
						count: sg.hits
					})
				}
			}

			/* Sort suggestions based on count */
			
			return output.sort( (a, b) => b.count - a.count)

		},
		normalizeSpellSuggestions(data){

			if(!data.hasOwnProperty('spellcheck')) return [];

			var {suggestions}  = data.spellcheck,
				i = suggestions.length,
				output = [],
				suggestedWords = [];

			while(i >= 0){

				i--;

				var sg = suggestions[i];

				if(typeof sg == 'string') continue;
				
				if(Array.isArray(sg)){

					output.push({
						term: sg[1],
						count: sg[3]
					})
				}

				if(sg instanceof Object){
					suggestedWords = sg.suggestion;
				}
			}

			return output.sort( (a, b) => b.count - a.count)

		},
		queryTransformer(params, mapping){

			var str = [],
				_mapping = mapping || config.mapping,
				multiSelectFacets = [];

			for(var i = 0; i < _mapping.length; i++){

				var item = _mapping[i],
					key = item.key,
					name = item.name,
					value = item.value

				if(params.hasOwnProperty(name)){

					switch(name){

						case 'page':
							value = (params[name] - 1)
							break;

						case 'facet_query':
							var facet = params[name],
								selectedValue = facet.map( (item) => {

									var { 
										operator, 
										multiSelect, 
										name, 
										selected, 
										type
									} = item;

									var op = operator? operator : 'OR',
										tag = multiSelect && op == 'OR'? '{!tag=' + name.slice(0,4) + '}' : '';

									/* Range|Rating with no Multi-select */
									
									if(
										(type == 'range' || type =='rating')
										&& !multiSelect) {
										return tag + name + ':([' + flatten(selected).join(' TO ') + '])';
									}

									/* Range|Rating can be multi Select */
									if(
										( type == 'range' || type == 'rating')
										&& multiSelect){
										
										var returnValue = selected.map( (val) =>{
											
											if(typeof val == 'string') return val;
											
											return '[' + val[0] + ' TO ' + val[1] + ']'
										})
										
										return tag + name + ':(' + flatten(returnValue).join(' ' + op + ' ') + ')';
									}

									if(multiSelect){

										multiSelectFacets.push(name)

										return [selected.map( (selected) => name + ':' + selected)]
									}
									
									
									/* Normal facet */
									
									return selected.map( (selected) => name + ':' + selected)

								});
							
							value = unnest(selectedValue);
							break;

						default:
							value = params[name];
							break;
					}
					
				}

				/**
				 * Check if Value is an array
				 */
				
				if(Array.isArray(value)){
					
					var vls = [];

					for(var j = 0; j < value.length; j ++){

						var val = value[j];
						
						if(config.array_separator){

							vls.push(val)
							
						}else{
							str.push({
								name: key,
								sysName: name,							
								value: val
							})
						}
					}

					if(config.array_separator){
						str.push({
							name: key,
							sysName: name,
							value: vls
						})
					}
				}
				else{

					str.push({
						name: key,
						sysName: name,
						value: value
					})
				}

			};
			
			/* Convert to key value pair */

			var keyValue = [];

			for(var i = 0; i < str.length; i++){

				var val = str[i].value;

				if(typeof val == 'object'){
					val = encodeURIComponent(JSON.stringify(val));
				}
				
				keyValue.push([str[i].name] + '=' + val)
			}

			
			var multiSelectArrays = [];
			var query = {
					"indexName":"products",
					"params": keyValue.join('&')
			};

				
			multiSelectArrays = multiSelectFacets.map( (item) => {
				
				var keyValueMultiSelect = [];

				for(var i = 0; i < str.length; i++){

					var val = str[i].value,
						sysName = str[i].sysName
					
					if(typeof val == 'object'){		

						if(sysName == 'facet_query') {
							
							var cloneValue = clone(val);

							for (var j=cloneValue.length-1; j>=0; j--) {

								var selectedFacets = cloneValue[j];

								if(Array.isArray(selectedFacets)){ // If Array
									for(var k = selectedFacets.length-1; k >= 0; k--){
										if(selectedFacets[k].indexOf(item) != -1){
											selectedFacets.splice(k, 1);
										}
									}									
								}
							}
							
							val = cloneValue
						}

						if(sysName == 'facet_field') val = [item]

						val = encodeURIComponent(JSON.stringify(val));
					}
					
					keyValueMultiSelect.push([str[i].name] + '=' + val)
				}

				return {
					...query,
					"params": keyValueMultiSelect.join('&')
				}
			});

			var s = {
				"requests": [query, ...multiSelectArrays]
			};

			return JSON.stringify(s)
		}
	}
}

export default adapter